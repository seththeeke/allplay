import type { AppConfig } from "../config";
import type { PlayerMe } from "../models/api";
import {
  cognitoConfigOf,
  configureAmplify,
  createAmplifyPlayerService,
  createAmplifyAdminService,
  createAmplifyApiClient,
  createAmplifyMergeApi,
  createAmplifyPreferencesService,
  type CallHeaders,
  type CognitoConfig,
  localAuthHeaders,
  amplifyCredentials,
} from "./live/amplifyServices";
import {
  createPollySpeechOutput,
  createTranscribeSpeechInput,
  pollySynthesizer,
  transcribeSender,
  transcribeStreamOpener,
} from "../voice/awsVoice";
import { createApiClient, type ApiClient } from "./live/apiClient";
import { createLiveAdminService } from "./live/liveAdminService";
import { withGuestMerge } from "./live/guestMerge";
import { DEV_CALLER_HEADER, devCallerFor } from "./live/devCaller";
import {
  createLiveDecisionService,
  createLiveGameService,
  createLiveSessionService,
  createLiveStatsService,
} from "./live/liveGameServices";
import { createLiveHealthService } from "./live/liveHealthService";
import { createLivePreferencesService } from "./live/livePreferencesService";
import { createLiveVoiceLabService } from "./live/liveVoiceLabService";
import { createMemoryAdminService } from "./memory/memoryAdminService";
import { createMemoryDecisionService } from "./memory/memoryDecisionService";
import { createMemoryGameService } from "./memory/memoryGameService";
import { memoryHealthService } from "./memory/memoryHealthService";
import { createMemoryVoiceLabService } from "./memory/memoryVoiceLabService";
import { createMemoryPlayerService, PLAYER_KEY } from "./memory/memoryPlayerService";
import { createMemorySessionService } from "./memory/memorySessionService";
import { createMemoryPreferencesService } from "./memory/memoryPreferencesService";
import { readStats } from "./memory/memoryStats";
import { createMemoryStore, type MemoryStore } from "./memory/memoryStore";
import type { AdminService, Services } from "./types";
import { createLocalServerSpeechInput, typedSpeechInput } from "../voice/speechInput";
import {
  createBrowserSpeechOutput,
  createLocalServerSpeechOutput,
  silentSpeechOutput,
  type SpeechOutput,
} from "../voice/speechOutput";

/** Voice output from the stage config (action-decision.md section 16): Polly deployed, Kokoro locally. */
function speechOutputFor(config: AppConfig, cognito: CognitoConfig | null): SpeechOutput {
  const browser = createBrowserSpeechOutput();
  if (config.speechOutput === "OFF") return silentSpeechOutput;
  if (config.speechOutput === "POLLY" && cognito !== null)
    return createPollySpeechOutput(pollySynthesizer(cognito.region, amplifyCredentials), browser);
  if (config.speechOutput === "LOCAL_SERVER" && config.apiUrl !== undefined)
    return createLocalServerSpeechOutput(config.apiUrl, browser);
  return browser;
}

/**
 * The admin API: signed with Amplify wherever Cognito is configured, through
 * the local server with the mock caller in local LIVE mode, else sample data.
 */
function adminFor(
  cognito: CognitoConfig | null,
  headers: CallHeaders | undefined,
  api: ApiClient | null,
): AdminService {
  if (cognito !== null) return createAmplifyAdminService(headers);
  return api === null ? createMemoryAdminService() : createLiveAdminService(api);
}

/**
 * Builds every service for the configured data mode. `LIVE` calls the API for
 * the game catalog, sessions, decisions and stats: signed by Amplify on
 * deployed stages, through the local server locally (WP-1). Player,
 * preferences and admin are live wherever Cognito is. The health check and
 * Voice Lab are live whenever the config has an API URL.
 */
export function createServices(
  config: AppConfig,
  store: MemoryStore = createMemoryStore(),
  seed: () => number = () => Math.floor(Math.random() * 2 ** 31),
): Services {
  /* Deployed stages sign in with Cognito and save preferences through the signed API (AA-9). */
  /* Locally, `localAuth: COGNITO_TEST` signs in with Test's Cognito and calls the local server (AA-11b). */
  const localCognito = config.stage === "LOCAL" && config.localAuth === "COGNITO_TEST";
  const cognito = config.stage !== "LOCAL" || localCognito ? cognitoConfigOf(config) : null;
  if (cognito !== null) configureAmplify(cognito, globalThis.location.origin);
  const callHeaders = localCognito ? localAuthHeaders : undefined;
  let live: Pick<Services, "games" | "sessions" | "decisions" | "stats"> | null = null;
  let liveApi: ApiClient | null = null;
  if (config.dataMode === "LIVE") {
    if (config.apiUrl === undefined) throw new Error("dataMode LIVE needs an apiUrl.");
    /* Locally the mock sign-in picks the caller (authn-authz.md section 11); deployed stages sign with Amplify (AA-9). */
    const api =
      config.stage === "LOCAL"
        ? createApiClient(config.apiUrl, undefined, () =>
            localCognito
              ? localAuthHeaders()
              : {
                  [DEV_CALLER_HEADER]: devCallerFor(store.read<PlayerMe | null>(PLAYER_KEY, null)),
                },
          )
        : createAmplifyApiClient();
    liveApi = config.stage === "LOCAL" ? api : null;
    live = {
      games: createLiveGameService(api),
      sessions: createLiveSessionService(api),
      decisions: createLiveDecisionService(api),
      stats: createLiveStatsService(api),
    };
  }
  /* Preferences are the signed API wherever Cognito is, the local server in local LIVE mode, else memory. */
  const preferences =
    cognito !== null
      ? createAmplifyPreferencesService(callHeaders)
      : liveApi === null
        ? createMemoryPreferencesService(store)
        : createLivePreferencesService(liveApi);
  const sessions = createMemorySessionService(store, seed);
  const voiceLab =
    config.apiUrl === undefined
      ? createMemoryVoiceLabService()
      : createLiveVoiceLabService(config.apiUrl);
  return {
    speechOutput: speechOutputFor(config, cognito),
    speechInput:
      config.speechInput === "TRANSCRIBE" && cognito !== null
        ? createTranscribeSpeechInput(
            transcribeSender(cognito.region, amplifyCredentials),
            config.vocabularyName,
            undefined,
            transcribeStreamOpener(cognito.region, amplifyCredentials, config.vocabularyName),
          )
        : config.speechInput === "LOCAL_SERVER" && config.apiUrl !== undefined
          ? createLocalServerSpeechInput((wav) => voiceLab.transcribe(wav))
          : typedSpeechInput,
    health:
      config.apiUrl === undefined ? memoryHealthService : createLiveHealthService(config.apiUrl),
    voiceLab,
    admin: adminFor(cognito, callHeaders, liveApi),
    games: createMemoryGameService(),
    sessions,
    preferences,
    player:
      cognito === null
        ? createMemoryPlayerService(store)
        : withGuestMerge(
            createAmplifyPlayerService(cognito, callHeaders),
            createAmplifyMergeApi(callHeaders),
            globalThis.sessionStorage,
          ),
    decisions: createMemoryDecisionService(sessions, preferences),
    stats: { list: () => Promise.resolve(readStats(store)) },
    ...live,
  };
}

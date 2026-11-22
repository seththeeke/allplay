import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  bedrockRuntime,
  createBedrockLlm,
  type ConverseApi,
} from "../../../../src/service/decision/llm/bedrockConverse";
import {
  LlmUnavailableError,
  type LlmRequest,
} from "../../../../src/service/decision/llm/llmClient";

const REQUEST: LlmRequest = {
  system: ["role", "guidance"],
  user: "<transcript>deal</transcript>",
  tool: { name: "classify", description: "Record it.", inputSchema: { type: "object" } },
  maxTokens: 60,
};

function api(
  response: Partial<Awaited<ReturnType<ConverseApi["send"]>>> | Error,
  credentials = true,
) {
  const send = vi.fn<ConverseApi["send"]>((_command, options) =>
    response instanceof Error
      ? Promise.reject(response)
      : options?.abortSignal?.aborted === true
        ? Promise.reject(new Error("aborted"))
        : Promise.resolve(response as Awaited<ReturnType<ConverseApi["send"]>>),
  );
  const stub: ConverseApi = {
    send,
    credentials: () => (credentials ? Promise.resolve({}) : Promise.reject(new Error("none"))),
  };
  return { stub, send };
}

const OK = {
  output: {
    message: {
      role: "assistant" as const,
      content: [
        { text: "ok" },
        { toolUse: { toolUseId: "t", name: "classify", input: { category: "GAME" } } },
      ],
    },
  },
  usage: {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    cacheReadInputTokens: 90,
    cacheWriteInputTokens: 0,
  },
  metrics: { latencyMs: 321 },
};

describe("Bedrock Converse LlmClient", () => {
  it("maps the request field for field and returns the forced tool's input", async () => {
    const { stub, send } = api(OK);
    const llm = createBedrockLlm(
      { modelId: "us.amazon.nova-micro-v1:0", region: "us-east-1" },
      stub,
    );
    expect(await llm.invoke(REQUEST)).toEqual({
      input: { category: "GAME" },
      modelId: "us.amazon.nova-micro-v1:0",
      latencyMs: 321,
      inputTokens: 100,
      outputTokens: 5,
    });
    const command = send.mock.calls[0]?.[0] as ConverseCommand;
    expect(command).toBeInstanceOf(ConverseCommand);
    expect(command.input).toEqual({
      modelId: "us.amazon.nova-micro-v1:0",
      system: [{ text: "role" }, { text: "guidance" }, { cachePoint: { type: "default" } }],
      messages: [{ role: "user", content: [{ text: "<transcript>deal</transcript>" }] }],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: "classify",
              description: "Record it.",
              inputSchema: { json: { type: "object" } },
            },
          },
        ],
        toolChoice: { tool: { name: "classify" } },
      },
      inferenceConfig: { maxTokens: 60, temperature: 0 },
    });
  });

  it("uses its own clock and zero usage when the response omits them", async () => {
    let clock = 0;
    const { stub } = api({ output: OK.output, usage: undefined, metrics: undefined });
    const llm = createBedrockLlm({ modelId: "m", region: "r" }, stub, () => (clock += 50));
    expect(await llm.invoke(REQUEST)).toMatchObject({
      latencyMs: 50,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("reports failures, timeouts and missing tool calls as unavailable", async () => {
    const failing = createBedrockLlm(
      { modelId: "m", region: "r" },
      api(new Error("ThrottlingException")).stub,
    );
    await expect(failing.invoke(REQUEST)).rejects.toThrow(
      "Bedrock failed: Error: ThrottlingException",
    );
    const slow: ConverseApi = {
      send: (_command, options) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
      credentials: () => Promise.resolve({}),
    };
    const timed = createBedrockLlm({ modelId: "m", region: "r", timeoutMs: 10 }, slow);
    await expect(timed.invoke(REQUEST)).rejects.toThrow("took too long");
    const silent = createBedrockLlm(
      { modelId: "m", region: "r" },
      api({ output: { message: { role: "assistant", content: [{ text: "no tool" }] } } }).stub,
    );
    await expect(silent.invoke(REQUEST)).rejects.toBeInstanceOf(LlmUnavailableError);
    const empty = createBedrockLlm({ modelId: "m", region: "r" }, api({}).stub);
    await expect(empty.invoke(REQUEST)).rejects.toThrow("no tool call");
  });

  it("reports throttling to its hook, and other failures not", async () => {
    const throttled = Object.assign(new Error("Too many requests"), {
      name: "ThrottlingException",
    });
    const onThrottled = vi.fn();
    await expect(
      createBedrockLlm({ modelId: "m", region: "r", onThrottled }, api(throttled).stub).invoke(
        REQUEST,
      ),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(onThrottled).toHaveBeenCalledTimes(1);
    await createBedrockLlm({ modelId: "m", region: "r", onThrottled }, api(new Error("x")).stub)
      .invoke(REQUEST)
      .catch(() => undefined);
    expect(onThrottled).toHaveBeenCalledTimes(1);
    await expect(
      createBedrockLlm({ modelId: "m", region: "r" }, api(throttled).stub).invoke(REQUEST),
    ).rejects.toThrow("Too many requests");
  });

  it("is available only when AWS credentials resolve", async () => {
    expect(await createBedrockLlm({ modelId: "m", region: "r" }, api(OK).stub).status()).toEqual({
      available: true,
      detail: "Bedrock, model m.",
    });
    expect(
      (await createBedrockLlm({ modelId: "m", region: "r" }, api(OK, false).stub).status())
        .available,
    ).toBe(false);
  });

  it("builds an SDK client with the default credential chain", async () => {
    const runtime = bedrockRuntime("us-east-1");
    /* Whatever the machine has, the call settles; no real credentials are asserted on. */
    await expect(
      runtime.credentials().then(
        () => true,
        () => true,
      ),
    ).resolves.toBe(true);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      runtime.send(new ConverseCommand({ modelId: "m", messages: [] }), {
        abortSignal: aborted.signal,
      }),
    ).rejects.toThrow();
  });
});

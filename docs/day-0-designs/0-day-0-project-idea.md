# All Play

I recently had a friend who is in their 70s who loves to play Spider Solitaire. They said their Parkinsons recently has made it extremely difficult to use the mouse so I got the idea of a voice controlled version of the game compatible for those who have similar disabilities. So, I'd like to start with Spider Solitaire, but build a platform which can expand to several card games, using common functions and re-usable components, potentially expanding to non-card based games as well. 

## Value Proposition

The most important factor in this concept is accessibility, focusing specifically on voice to action. It needs to be fast and accurate, with simple controls, using the largest buttons on a keyboard to ensure very little use of a mouse or movement altogether. 

## Product Design

### Overall

At the onset, it will be a web based portal, allowing a user to go to allplaygames.com(or similar) and select a game, with their voice or with a mouse and easily setup a game session, focused on single player games for now, but also wanting to do multi-player games in the future, creating a clean separation between the game engine and the social aspects of the game, whether it be multi-player or not. They also need to be able to directly navigate to the game they play frequently, e.g. allplaygames.com/spider which automatically navigates them to their game to start. 

We need some easy actions for increasing the size of the content on the page, such as Zoom In or Zoom Out on top of actual player actions. Additionally, we should be able to control the style of the page via voice for those with color blindness, such as change style to black and white, etc which is backed by specific stylesheets. 

Action Oriented design. We will need to consume voice input and make a decision. I want to ensure that decision is highly accurate, so since this is a game concept, we need to precompute all, or most, or the potential actions that can be done and leverage GenAI only to select the action, not to actually execute anything in the game engine. Effectively having the game engine vend potential moves and then letting the AI transcribe the question and then again letting AI determine what action they are trying to take. However, the action itself is determistic based on the game engine. 

In order to action a voice command, it needs to be a simple action such as pressing the space bar, and then following that action and recording their request, I'd like the ability to stop listening when we believe its over while still leaving an option avalable to close with another space bar click. I would also like a feature to allow the user to either confirm the action or auto-confirm the action based on the users preference. 

### User Management

All games will be free and we'll have the ability to login if they'd like, but if they don't we'll keep some kind of session storage to keep their identity and preferences. I anticipate the majority of users would be navigating there without logging in which is totally fine. When a user logs in, we can keep more of their preferences sticky from previous sessions. All user functions need to be dead simple, basic login/signup/signout, with any other preferences throught he application being more of an auto-save as they play their games. We need to ensure we have layered preferences at a high level user level while also having game specific preferences.

### Web Design

For the web client, it needs to be dead simple, animations are good for the actual game playing, but nothing outrageous. And we should have oversized buttons on the page and overall default to a larger font across the app. 

### Mobile Design

The application should be compliant for mobile devices. 

### IOS App Design

The IOS App will be free to play with an optional login function. It will use the devices microphone, operating similarly to the web app and utilizing the same overall app flow. 

### Help Content

Help content on how to learn the system needs to be available in all clients where it will highlight on the page and provide them a workflow to show them what they want to do next. This will show up upon the first time a user starts a game via a cookie save and also be able to show to them should they need it.

### Admin Functions

The Admin functions will allow the user to access a protected API to deploy the codebase on demand as well as view product metrics. This needs to be hidden behind an admin route and authenticated as such. There will be no buttons on the product indicating you can access an Admin page, it will just be behind /admin. 

### Moonshot

The moonshot idea for this product is that any person would be able to add a game to this application by simply specifying a link to the rules of their game or providing that context and our application can create and derive the rules of the game, what actions are available, and allow them to play their game. This requires a level of sophistication in the game engine to provide this kind of function. 

### Key Metrics

The following metrics are pivotal to track for overall application performance. There will be others to measure as well.

- Number of Total Users
- Number of Active Users(players in past 30 days)
- Number of Turn Failures - via the AI
- Overall round trip response for Move request

## System Design

### Isolation

#### The Game Engine

The game engine components must be separated from the rest of application and able to be re-used across several types of games. For example, the ability to create a deck, shuffle, deal cards, etc should be common components leveraged by several games with hooks to deal cards or setup a game board. 

The game engine needs a restrictive interface which enforces the rules of the game and vends available moves to a client, such as a player or request client. These rules need to be isolated from other games and allow a client to "start a game" which stores a persistent state of that game in reference to a rule set. The ability to pause and resume a game will be specified based on the game type, e.g. solo vs against another online player. 

#### Speech and Action Decider

The action decision needs to be isolated from the game engine components and should only interface with the game engine through the public interface methods it exposes. The action decider owns consuming the speech information from the client and transcribing that speech information into text. It then owns requesting what available moves can be taken and consuming those actions and pushing those into the LLM to decide which action the LLM wants to take. Prior to confirming with the user, it will invoke a verification flow with the game engine to ensure it is a valid action and then owns the confirmation flow from the user(or auto-approve) to then invoke the deterministic action within the game engine.

The action decision needs to also consume whether the action is specific to the application or the game, allowing users to change the application style, etc. This is a layer prior to the action decider, with an LLM only choosing whether its a game action or application action.

#### Game Building

We are starting with Spider Solitaire, but to satisfy the Moonshot, we will need to have a game building component which can derive rules and apply those rules to the Game Engine to allow for game configuration assuming partial to many types of decks may be selected. This is unlikely to be used by our users as they want simplicity, but a community of games created by the users would be supported as a separate function which needs the right amount of isolation from our core games which are verified and created by our team.

### Authentication and Authorization

We will have basic authentication, with the exposure to signin with Apple or Google on top of username or password. We will need basic pre and post authentication hooks to manage this and support password forget and verification with a custom email template for the users. We will have 3 roles, Player(any signed in user), Admin(only me and any select individuals), and PlayerPlus(some additional permissions on top of player which are not yet defined). Each will carry its own permissions. Admin will also see more tabs on the Client Apps(Web + IOS) than normal player clients which needs built into the application. 

I have built authentication and authorization into a couple apps you can use for inspiration - https://github.com/seththeeke/nyc-311 (basic role based), https://github.com/seththeeke/rook (FaceID on IOS), https://github.com/seththeeke/survive-and-advance (signin with Google+Apple). 

### Technology

I am an experienced AWS Engineer and I want to use the AWS Stack.

We should use the following technologies
* React Web Application - the website will be built on React stack
* Swift - the IOS app will be built using swift
* Amplify - we will use Amplify framework for authentication across all clients
* Typescript - we will use Typescript across the entire stack, backend, frontend, and infrastructure(CDK)
* CDK - we will use CDK for all infrastructure definition
* Code Pipeline - we will have a pipeline which deploys all changes across both a test and production environment only once per day or on demand to save on cost, but keep deployments consistent. We will have a mutation step in the code pipeline to allow it to self mutate.
* Github - we will store all code on github and can trigger actions for code push from there
* AWS Transcribe - we will use Transcribe to consume speech and consume to text
* AWS Polly - we will use Polly to transcribe responses back to users if they want voice response
* AWS Lambda - the backend will be written as Lambda functions using Typescript
* AWS Bedrock - we will use Bedrock to determine what action to take
* AWS API Gateway - we will interface with the client through API Gateway
* AWS DynamoDB - we will use DDB for storage across the entire application
* AWS Cognito - we will use Cognito for user authentication
* Any other technology will default to AWS version as we modify things

### Verification and Test Infrastructure

Non-negotiables include
1. 95%+ unit test coverage across the web, cdk, and backend code bases
2. Integration test coverage across the api endpoints
3. Linter across the entire codebase, taking inspiration from linting done in my previous project - https://github.com/seththeeke/nyc-311. Taking inspiration from it, the theme is that Claude.md and skills help with managing the codebase, but linters and rules enforce when that goes wrong.

For cost saving measures, I'd like to discuss what other telemetry, metrics, etc are required for the application.

## Build out Plan

### Spec Definition

The build plan must be done in the following high level stages. 

1. Context gathering - you will gather context required and ask a series of questions to gain clarity on the problem statement
2. Interrogation - you will interrogate me on the problem statement to clarify your understanding and any gaps. You will add any clarifications to the Appendix.ClaudeClarifications below.
3. Data Modeling - the data model for the game engine and user content and rules is pivotal and must scale, we will start by modeling the data and you will create a dedicated spec, docs/day-0-designs/data-model.md which includes every entity we plan to persist, indexes we need to create, and a sample entity in JSON form for each entity. 
4. Game Engine Design - the game engine/rule engine is the backbone for the application, you will create a dedicated spec, docs/day-0-designs/game-engine.md where we will define how the game engine operates, specifically defining its public accessors to align on how the client will interface
5. Action Decision Engine - the voice to action model will get its own spec as well, docs/day-0-designs/action-decision.md which will outline what technology will be used and how a decision will be used, invoking the LLM model as few times as possible to achieve an outcome. 
6. Authentication and Authorization - this should be straightforward, but also will have its own spec, docs/day-0-designs/authn-authz.md
7. CDK stack definition - this should be straightforward, defining initial CDK stack creation, whether we can support one vs many stacks, and overall separation of concerns on the codebase.
8. Claude specifics - you will define the Claude.md file which has already been started. You can take inspiration from this CLAUDE.md in my most recent project, but you must not exceed 100 lines or 1000 words, we will expand on this as this project evolves and use a near identical project structure
9. Spider Solitaire - this will be the addition of spider solitair logic implemented on top of the game engine. Its important that it plugs in as expected. Game context and rules for spider solitaire can be found here - /Users/seththeeke/Documents/projects/allplay/docs/game-context/spider-solitaire and you can search the web for more information as needed.

### Execution Plan

At a high level, we will execute in the following order

1. Claude.md setup - setup claude.md
2. Rule and build setup - setup linters, build tools. etc.
3. Web App prototyping - build the web app prototype for what it will look like, this will be a prototype, but will be built into once we refine design, it should follow our expected web-app structure, but with mock data and endpoints
4. Authentication - build authentication and authorization full stack, with the public and admin routes available
5. Game Engine - build out the game engine in isolation and test that it works with a sample game as a backend component and integration tests 
6. Backend decision actions - build out the action decider
7. Web app polishing - Flesh out the remaining web app integrations
8. Mobile App development - flesh out a basic Swift application on the same stack

### Document Guidelines

Each document WILL:
1. Be declarative, it will state what it will do, not be littered with choices it may or may not have taken
2. Be broken into several legs for implementation, each leg with its own commit for isolation, and be broken down even further than just this doc.

Each document WILL not:
1. Contain any emojis or icons

## Appendix

### Claude Clarifications

#### Spider Solitaire Rules

1. Rule variant: the Microsoft deal is the default (54 cards dealt as 4 piles of 6 and 6 piles of 5, five stock deals of 10) with 1, 2 and 4 suit difficulty levels. The Hoyle deal from docs/game-context/spider-solitaire/basics.md is supported as a game configuration variant.
2. Game aids: unlimited undo back to the start of the game, with each undo costing 1 point. A "hint" command highlights one legal move sourced from the engine and reads it aloud when voice output is enabled. Microsoft scoring applies: start at 500, minus 1 per move, plus 100 per completed run. Win/loss statistics are tracked per player and per suit level (games played, games won, win rate, best score) and shown on a stats screen.
3. Move references: every column displays a large number from 1 to 10. Players reference moves by column ("column 3 to 7", "3 to 7") or by card ("seven of hearts onto the eight"). When a command matches more than one legal move, the client shows numbered choices and the player selects one by saying its number.

#### Voice and the Action Decider

4. LLM layering: the action decider uses two Bedrock layers as specified. Layer one classifies the transcript as an application action or a game action. Layer two selects the specific action from the candidate set for that category (application actions, or the legal moves vended by the game engine). A turn makes at most two LLM calls.
4a. LLM model: both layers use the cheapest AWS-native Bedrock model, Amazon Nova Micro, through the Bedrock Converse API. The model id is configuration per layer so it can be changed without code changes; model changes are gated by the offline utterance evaluation set.
5. Transcription path: the client streams audio directly to Amazon Transcribe streaming using temporary credentials from a Cognito Identity Pool, which supports both guest (unauthenticated) and signed-in identities. Transcribe end-of-speech detection stops listening automatically, and pressing Space also ends listening. Latency target: median under 2 seconds from end of speech to the proposed move appearing on screen.
6. Key mapping: Space starts and stops listening. Enter confirms a proposed action. Escape cancels a proposed action. Spoken "yes" and "no" are equivalent to Enter and Escape.
7. Voice output: Polly is off by default and enabled per player preference. When enabled it speaks confirmation prompts, errors and hints. Reading board state aloud is out of scope; the primary audience is players with motor impairments.
8. Data retention: audio is never stored. Each turn persists its transcript, the candidate actions, the selection made by each LLM layer and the outcome, with a 30 day DynamoDB TTL.
9. Turn failure definition: a turn is a hard failure when the decider maps the transcript to no action, when the selected action fails engine validation, or when the player rejects the proposed action. A turn is a soft failure when the command was ambiguous and the player chose from numbered options. An undo following an auto-confirmed move is not counted as a failure.

#### Engine and Architecture

10. Engine hosting: the game engine runs only on Lambda and is the sole authority on game state. Clients render the state returned by the API and never compute legal moves or apply rules locally.
11. Game definitions: every game, including Spider Solitaire, is a declarative rules document interpreted by a generic engine. Setup (decks, piles, deal), move rules, automatic effects (such as removing a completed run) and win/loss conditions are expressed as data. Core games and future community games share the same rules format; the moonshot game builder produces documents in that format.
12. Guest identity: each guest receives a Cognito Identity Pool unauthenticated identity, cached in the browser. Guest games and preferences persist in DynamoDB keyed by that identity ID, and the same identity issues the temporary credentials used for Transcribe streaming. On signup or login, the guest's games, preferences and statistics merge into the authenticated account.
13. Multiplayer: no multiplayer functionality is built initially. The data model and engine interface separate a session/seat layer from game state: every game session has one or more seats, and Spider Solitaire uses exactly one.
14. Pointer input: players can tap or click a card to select it, which highlights its legal destinations as returned by the server, and then tap the destination. Drag-and-drop is also supported. On mobile, a large on-screen "talk" button replaces the Space key.

#### Platform and Operations

15. AWS accounts: Test and Prod are separate CDK stages deployed into a single AWS account, with the pipeline in the same account. All resource names are stage-prefixed.
15a. Domain: no domain is registered yet. Both stages serve from their default CloudFront URLs, and the CDK stacks accept an optional domain configuration so a custom domain and certificate can be attached later without restructuring.
16. Promotion: the pipeline runs on a daily schedule and on demand from /admin. It deploys to Test, runs the integration test suite against Test, and deploys to Prod automatically when those tests pass. The pipeline self-mutates before deploying.
17. Metrics: daily metric rollups (total users, 30 day active users, hard and soft turn failures, move round-trip latency) are stored in DynamoDB and charted directly in the /admin page. No CloudWatch dashboard is built.
17a. Cost ceiling: fixed infrastructure cost stays under $25 per month, excluding usage-driven Bedrock and Transcribe charges. The stack is serverless only with no always-on resources (no NAT gateways, no provisioned capacity), and an AWS Budgets alarm fires at the limit.
18. iOS speech: the iOS app transcribes speech on-device with Apple's Speech framework and sends the transcript text to the same action decider API used by the web client. The action decider therefore accepts transcript text as its input, independent of the transcription source.
19. Repository layout: the repository follows the nyc-311 structure with top-level web-app/, backend/, cdk/ and ios/ directories. The game engine lives at backend/src/game-engine and lint rules forbid it from importing anything outside that directory. The nyc-311 CLAUDE.md is the model for this project's CLAUDE.md.

#### Accessibility Scope

20. Themes: the initial release ships a default theme plus high contrast, black and white, four-color deck and dark mode themes, each backed by its own stylesheet and switchable by voice command.
20a. Standard and language: the web and iOS clients target WCAG 2.2 AA and respect the system reduced-motion setting. The application is English only; all UI strings live in a strings file to allow localization later.

#### Execution Plan

21. Pipeline walking skeleton: after the web app prototype and before authentication, the pipeline is built and running end to end with a lean sample web app, backend route, CDK resource, unit tests and integration tests (phase 3a in `README.md`). No application feature phase starts until a full pipeline run has deployed through Prod.

21a. Skeleton scope: the walking skeleton serves the web prototype through CloudFront, deploys through the CDK pipeline connected to GitHub, and exposes a health check as a dedicated Lambda behind the HTTP API's default URL. It is done when the site loads at its CloudFront URL and its `/health` page shows a `200` from `GET /v1/health`. Mocks still in the prototype are tracked in `prototype-mocks.md`.

21b. Local development: the entire stack runs on a developer's machine in memory through a local Node.js server that wraps the Lambda handlers, before any DynamoDB table is built. The AWS Emulator is not used (`local-development.md`).

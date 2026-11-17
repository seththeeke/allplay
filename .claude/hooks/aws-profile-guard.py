#!/usr/bin/env python3
"""
PreToolUse guard: every AWS CLI or CDK call made from this project uses the
`allplays` profile, and nothing ever reaches the default or nyc311 profiles.

Wired in .claude/settings.json for Bash, so it covers the main session and
every subagent. Exit 2 blocks the command and returns the message to Claude;
exit 0 allows it.

Rules:
1. Any `--profile <name>` must be `allplays`.
2. Any AWS_PROFILE / AWS_DEFAULT_PROFILE assignment must be `allplays`, and
   neither may be unset or removed with `env -u`.
3. Inline credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
   AWS_SESSION_TOKEN) and redirected credential or config files are blocked.
4. Every `aws`, `cdk` or `sam` invocation (direct, through npx, npm exec,
   pnpm dlx or node_modules/.bin) must carry `--profile allplays` in the same
   command segment.

Exception: AWS Emulator calls (cdk-stacks.md section 13). A command whose
AWS_ENDPOINT_URL or --endpoint-url points at 127.0.0.1 or localhost may use
the emulator's own credential and config files under ~/.aws/emulator and may
unset AWS_PROFILE, but still may not name any other profile.
"""

import json
import os
import re
import sys

PROFILE = "allplays"
AWS_TOOLS = {"aws", "cdk", "sam"}
WRAPPERS = {"sudo", "env", "time", "command", "exec", "nohup"}

SEGMENT_SPLIT = re.compile(r"\|\||&&|;|\||\n|\$\(|`|\(|\)")
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
# A variable assignment starts a word: line start, whitespace, or a shell separator, never a quote.
WORD_START = r"(?:^|(?<=[\s;&|(]))"
LOCAL_ENDPOINT = re.compile(
    r"(AWS_ENDPOINT_URL[A-Z_]*=|--endpoint-url[= ])['\"]?https?://(127\.0\.0\.1|localhost)(:\d+)?",
)
EMULATOR_FILE = re.compile(r"^['\"]?(~|\$HOME|\$\{HOME\}|/Users/[^/]+|/home/[^/]+)/\.aws/emulator/")


def deny(reason: str) -> None:
    sys.stderr.write(
        f"aws-profile-guard: {reason} This project uses only the '{PROFILE}' AWS profile "
        f"(CLAUDE.md section 4). Add '--profile {PROFILE}' or run against the AWS Emulator.\n"
    )
    sys.exit(2)


def strip_quotes(value: str) -> str:
    return value.strip().strip("'\"")


def check_profile_flags(cmd: str) -> None:
    for match in re.finditer(r"--profile(?:=|\s+)(\S+)", cmd):
        value = strip_quotes(match.group(1))
        if value != PROFILE:
            deny(f"'--profile {value}' is not allowed.")


def check_profile_env(cmd: str, emulator: bool) -> None:
    for match in re.finditer(WORD_START + r"(AWS_PROFILE|AWS_DEFAULT_PROFILE)=(\S*)", cmd):
        value = strip_quotes(match.group(2))
        if value != PROFILE:
            deny(f"'{match.group(1)}={value}' is not allowed.")
    unsets = re.search(r"\bunset\b[^;&|\n]*\bAWS_(DEFAULT_)?PROFILE\b|\benv\b[^;&|\n]*-u\s*AWS_(DEFAULT_)?PROFILE\b", cmd)
    if unsets and not emulator:
        deny("unsetting AWS_PROFILE would fall back to the default profile.")


def check_credentials(cmd: str, emulator: bool) -> None:
    if re.search(WORD_START + r"(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)=", cmd) and not emulator:
        deny("inline AWS credentials are not allowed.")
    for match in re.finditer(WORD_START + r"(AWS_SHARED_CREDENTIALS_FILE|AWS_CONFIG_FILE)=(\S+)", cmd):
        if not (emulator and EMULATOR_FILE.match(match.group(2))):
            deny(f"'{match.group(1)}' may point only at the emulator's files under ~/.aws/emulator.")


def invoked_tool(segment: str) -> str | None:
    """Returns the AWS tool a command segment runs, if any."""
    words = segment.strip().split()
    index = 0
    while index < len(words):
        word = strip_quotes(words[index])
        if ASSIGNMENT.match(word) or word in WRAPPERS or word.startswith("-"):
            index += 1
            continue
        if word in {"npx", "pnpx"}:
            index += 1
            continue
        if word in {"npm", "pnpm", "yarn"} and index + 1 < len(words) and words[index + 1] in {"exec", "dlx", "x"}:
            index += 2
            continue
        if word == "npm" and index + 2 < len(words) and words[index + 1] in {"run", "run-script"} and words[index + 2] == "cdk":
            return "cdk"
        base = os.path.basename(word)
        if base == "aws-cdk":
            return "cdk"
        return base if base in AWS_TOOLS else None
    return None


def check_invocations(cmd: str, emulator: bool) -> None:
    for segment in SEGMENT_SPLIT.split(cmd):
        tool = invoked_tool(segment)
        if tool is None:
            continue
        words = segment.split()
        if tool == "aws" and any(word in {"--version", "help"} for word in words[1:3]):
            continue
        if tool == "cdk" and any(word in {"--version", "--help", "-h"} for word in words):
            continue
        if re.search(rf"--profile(?:=|\s+)['\"]?{PROFILE}['\"]?(\s|$)", segment):
            continue
        if emulator:
            continue
        deny(f"'{segment.strip()}' does not pass '--profile {PROFILE}'.")


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    if not isinstance(cmd, str) or not cmd.strip():
        sys.exit(0)
    emulator = bool(LOCAL_ENDPOINT.search(cmd))
    check_profile_flags(cmd)
    check_profile_env(cmd, emulator)
    check_credentials(cmd, emulator)
    check_invocations(cmd, emulator)
    sys.exit(0)


if __name__ == "__main__":
    main()

import { PASSWORD_REQUIREMENTS } from "../models/api";

/** Each password rule, and the match with the confirmation, as met or still needed. */
export function passwordChecks(
  password: string,
  confirmation: string,
): { text: string; met: boolean }[] {
  return [
    ...PASSWORD_REQUIREMENTS.map((requirement) => ({
      text: requirement.text,
      met: requirement.met(password),
    })),
    { text: "Both passwords match", met: password !== "" && password === confirmation },
  ];
}

/** True when the password meets every rule and matches its confirmation. */
export const passwordReady = (password: string, confirmation: string): boolean =>
  passwordChecks(password, confirmation).every((check) => check.met);

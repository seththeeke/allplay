import { PageHeading } from "../components/PageHeading";

const SECTIONS: [string, string[]][] = [
  [
    "What All Play keeps",
    [
      "Your games: the moves, scores and statistics of the games you play.",
      "Your settings, such as text size, colors and voice replies.",
      "If you make an account: your email address, your name if you share it, and how you sign in (email, Google or Apple).",
      "Each voice command as text, with what All Play did with it, for 30 days, so we can make understanding better.",
    ],
  ],
  [
    "What All Play does not keep",
    [
      "Recordings of your voice. Speech is turned into text as you speak and the sound is never stored.",
      "Anything for advertising. All Play shows no ads and shares nothing with advertisers.",
    ],
  ],
  [
    "Playing without an account",
    [
      "You can play every game without an account. Your games and settings are kept for 90 days after your last visit, then deleted.",
    ],
  ],
  [
    "Deleting your account",
    [
      "Open Account and choose Delete account. Your account, games, settings and statistics are deleted right away. If you signed in with Apple, All Play is also removed from your Apple ID.",
    ],
  ],
];

/** The privacy policy (authn-authz.md section 12): plain words, large type. */
export function PrivacyPage(): React.JSX.Element {
  return (
    <main className="flex max-w-3xl flex-col gap-8">
      <PageHeading title="Privacy" lead="What All Play keeps about you, and how to remove it." />
      {SECTIONS.map(([heading, items]) => (
        <section key={heading} className="flex flex-col gap-3">
          <h2 className="text-3xl font-bold">{heading}</h2>
          <ul className="flex list-disc flex-col gap-2 pl-8 text-2xl">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

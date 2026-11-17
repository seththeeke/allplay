import { Link } from "react-router";

/** Shown for unknown paths, and for /admin to anyone who is not an admin (authn-authz.md section 7.1). */
export function NotFoundPage(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-5xl font-bold">Page not found</h1>
      <p className="mt-4 text-2xl">
        <Link className="underline" to="/">
          Go to the home page
        </Link>
      </p>
    </main>
  );
}

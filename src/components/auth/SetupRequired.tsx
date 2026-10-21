import { BrandMark } from "@/components/app/BrandMark";
import { Card, CardBody, CardDescription, CardHeader } from "@/components/ui";

export type SetupRequiredProps = {
  /** Names of the missing environment variables. Values are never shown. */
  missing: string[];
};

/**
 * Setup_Screen (22.9). Shown instead of the app when Supabase env vars are
 * missing or empty. Lists variable names only and points to `.env.local`.
 */
export function SetupRequired({ missing }: SetupRequiredProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg-subtle px-4 py-10">
      <div className="flex items-center gap-2.5">
        <BrandMark size={32} />
        <span className="text-[17px] font-semibold tracking-[-0.03em] text-text">Companion</span>
      </div>
      <Card as="section" aria-labelledby="setup-required-title" className="w-full max-w-lg">
        <CardHeader>
          <h1 id="setup-required-title" className="text-base font-semibold tracking-[-0.02em] text-text">
            Setup required
          </h1>
          <CardDescription>
            The app needs a Supabase project before you can sign in. Add these variables to{" "}
            <code className="font-mono text-text">.env.local</code>, then restart the dev server.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <p className="text-sm font-medium text-text">Missing variables</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {missing.map((name) => (
              <li key={name}>
                <code className="rounded-sm bg-surface px-2 py-1 font-mono text-[13px] text-text">{name}</code>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">
            See <code className="font-mono text-text">.env.example</code> and the README for where to find each value.
          </p>
        </CardBody>
      </Card>
    </main>
  );
}

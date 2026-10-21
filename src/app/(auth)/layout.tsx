import { BrandMark } from "@/components/app/BrandMark";
import { AuthFooter } from "@/components/auth/AuthFooter";

/**
 * Minimal layout for the Public_Auth_Pages (22.1–22.3): no AppShell and no
 * Local_Store (AppRoot skips its boot on these paths).
 */
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-bg-subtle">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 size-[420px] rounded-full bg-gradient-brand opacity-[0.12] blur-3xl animate-float-soft" />
        <div
          className="absolute -right-24 bottom-0 size-[380px] rounded-full bg-gradient-brand opacity-[0.1] blur-3xl animate-float-soft"
          style={{ animationDelay: "1.5s" }}
        />
      </div>
      <main id="main" className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-[420px] animate-fade-up">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <BrandMark size={44} className="shadow-glow rounded-[7px]" />
            <div>
              <p className="text-[17px] font-semibold tracking-[-0.03em] text-text">Companion</p>
              <p className="mt-0.5 text-[13px] text-muted">A friend who checks in, every day.</p>
            </div>
          </div>
          {children}
        </div>
      </main>
      <AuthFooter />
    </div>
  );
}

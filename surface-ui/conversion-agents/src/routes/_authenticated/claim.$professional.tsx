import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ServerFnError, useServerFn } from "@v3/ui/lib/server-fn";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { lovable } from "@v3/conversion-agents/integrations/lovable";
import { submitClaim, verifyClaimCode } from "@v3/conversion-agents/lib/claim.functions";
import { Button } from "@v3/ui/components/ui/button";
import { Card, CardContent } from "@v3/ui/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@v3/ui/components/ui/avatar";
import { Badge } from "@v3/ui/components/ui/badge";
import { Input } from "@v3/ui/components/ui/input";
import { Label } from "@v3/ui/components/ui/label";
import {
  BadgeCheck,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  Loader2,
  AlertCircle,
  Sparkles,
  ArrowRight,
} from "lucide-react";

type ClaimResult = Awaited<ReturnType<typeof submitClaim>>;

type ClaimProf = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  slug: string;
  headline: string | null;
  photo_url: string | null;
  address_city: string | null;
  address_state: string | null;
  gcid: string | null;
  claimed: boolean | null;
  search_rank_score: number | null;
  local_rank: number | null;
  local_rank_of: number | null;
  gbp_connected: boolean | null;
  bio: string | null;
  primary_license_type: string | null;
};

function profileQuery(slug: string) {
  return queryOptions({
    queryKey: ["claim-profile", slug],
    queryFn: async () => {
      try {
        return await api.get<{ prof: ClaimProf; licenseLabel: string }>(
          `/conversion-agents/claim-profile/${encodeURIComponent(slug)}`,
        );
      } catch (e) {
        if (e instanceof ServerFnError && e.status === 404) throw notFound();
        throw e;
      }
    },
  });
}

export const Route = createFileRoute("/_authenticated/claim/$professional")({
  ssr: false,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(profileQuery(params.professional)),
  head: ({ params }) => ({
    meta: [
      { title: `Claim this profile — Experience.com` },
      {
        name: "description",
        content: `Claim the profile for ${params.professional} and see your Search Rank Score.`,
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">Profile not found.</p>
    </div>
  ),
  component: ClaimPage,
});

type Step = "preview" | "auth" | "processing" | "verify" | "manual" | "done";

function ClaimPage() {
  const { professional } = Route.useParams();
  const { data } = useSuspenseQuery(profileQuery(professional));
  const { prof, licenseLabel } = data;
  const submit = useServerFn(submitClaim);
  const verifyCode = useServerFn(verifyClaimCode);

  const [step, setStep] = useState<Step>("preview");
  const [hasSession, setHasSession] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [license, setLicense] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimResult | null>(null);

  // Session detection
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
        setHasSession(!!session);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const fullName =
    prof.display_name ??
    [prof.first_name, prof.last_name].filter(Boolean).join(" ");

  async function runSubmit(licenseNumber?: string, otp?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = otp
        ? await verifyCode({ data: { professionalId: prof.id, code: otp } })
        : await submit({
            data: { professionalId: prof.id, licenseNumber: licenseNumber ?? null },
          });
      setResult(res);
      if (res.message) setError(res.message);
      if (res.status === "approved") setStep("done");
      else if (res.status === "needs_verification") setStep("verify");
      else if (res.status === "manual_review") setStep("manual");
      else if (res.status === "already_claimed") {
        setError("This profile has already been claimed.");
        setStep("preview");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStep("preview");
    } finally {
      setBusy(false);
    }
  }

  // Auto-submit after sign-in
  useEffect(() => {
    if (hasSession && step === "auth" && !autoSubmitted) {
      setAutoSubmitted(true);
      setStep("processing");
      runSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSession, step, autoSubmitted]);

  async function signInGoogle() {
    setStep("auth");
    setError(null);
    const res = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.href,
    });
    if (res.error) {
      setError("Sign-in failed. Please try again.");
      setStep("preview");
    }
  }

  async function startClaim() {
    if (hasSession) {
      setStep("processing");
      await runSubmit();
    } else {
      await signInGoogle();
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        {/* Profile preview card */}
        <Card className="overflow-hidden">
          {step === "preview" && !prof.claimed && (
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 flex items-start gap-3">
              <Sparkles className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Is this you?</p>
                <p className="text-sm text-white/90">
                  Claim your free profile and see your Search Rank Score.
                </p>
              </div>
            </div>
          )}
          {prof.claimed && step === "preview" && (
            <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-3 flex items-center gap-2 text-emerald-800 text-sm">
              <BadgeCheck className="w-4 h-4" />
              This profile is already claimed.
            </div>
          )}
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="w-20 h-20">
                <AvatarImage src={prof.photo_url ?? undefined} alt={fullName} />
                <AvatarFallback>
                  {(prof.first_name?.[0] ?? "") + (prof.last_name?.[0] ?? "")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-semibold">{fullName}</h1>
                {prof.headline && (
                  <p className="text-muted-foreground text-sm mt-0.5">
                    {prof.headline}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                  {prof.address_city && (
                    <span>
                      {prof.address_city}
                      {prof.address_state ? `, ${prof.address_state}` : ""}
                    </span>
                  )}
                  {prof.primary_license_type && (
                    <Badge variant="outline" className="text-xs">
                      {prof.primary_license_type}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {step === "preview" && !prof.claimed && (
              <div className="mt-6">
                <Button
                  size="lg"
                  className="w-full text-base"
                  onClick={startClaim}
                  disabled={busy}
                >
                  Claim This Profile
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
                {error && (
                  <p className="text-sm text-red-600 mt-3 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4" /> {error}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step: auth in progress */}
        {step === "auth" && (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <ShieldCheck className="w-10 h-10 text-blue-600 mx-auto" />
              <h2 className="text-lg font-semibold">
                Sign in with Google to verify your identity
              </h2>
              <p className="text-sm text-muted-foreground">
                We use Google to confirm it's really you. Takes 5 seconds.
              </p>
              <Button onClick={signInGoogle} size="lg" disabled={busy}>
                Continue with Google
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step: processing */}
        {step === "processing" && (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600" />
              <p className="text-sm text-muted-foreground">
                Verifying your identity…
              </p>
            </CardContent>
          </Card>
        )}

        {/* Step: verification needed */}
        {step === "verify" && result && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-6 h-6 text-amber-600 mt-0.5" />
                <div>
                  <h2 className="text-lg font-semibold">
                    We need to verify a few things
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {result.challenge?.sent
                      ? `We emailed a 6-digit code to the address on this profile${
                          result.challenge.destination ? ` (${result.challenge.destination})` : ""
                        }. Enter it to confirm it's you.`
                      : `Enter your ${licenseLabel.toLowerCase()} to complete your claim instantly.`}
                  </p>
                </div>
              </div>
              <ConfidenceBar score={result.confidence ?? 0} />
              {result.challenge?.sent ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="code">Verification code</Label>
                    <Input
                      id="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="6-digit code"
                    />
                  </div>
                  <Button
                    className="w-full"
                    size="lg"
                    disabled={busy || code.length !== 6}
                    onClick={() => runSubmit(undefined, code)}
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify and claim"}
                  </Button>
                </>
              ) : (
              <>
              <div className="space-y-2">
                <Label htmlFor="license">{licenseLabel}</Label>
                <Input
                  id="license"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  placeholder={`Enter your ${licenseLabel.toLowerCase()}`}
                />
              </div>
              <Button
                className="w-full"
                size="lg"
                disabled={busy || !license.trim()}
                onClick={() => runSubmit(license.trim())}
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Verify and claim"
                )}
              </Button>
              </>
              )}
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step: manual review */}
        {step === "manual" && result && (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <ShieldCheck className="w-10 h-10 text-amber-600 mx-auto" />
              <h2 className="text-lg font-semibold">
                Our team will review your claim
              </h2>
              <p className="text-sm text-muted-foreground">
                We've received your claim and our verification team will review
                it within 1 business day. You'll get an email when it's
                approved.
              </p>
              <ConfidenceBar score={result.confidence ?? 0} />
            </CardContent>
          </Card>
        )}

        {/* Step: done */}
        {step === "done" && result && (
          <DoneCard prof={prof} />
        )}
      </div>
    </div>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>Verification confidence</span>
        <span>{score}/100</span>
      </div>
      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600"
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function DoneCard({
  prof,
}: {
  prof: {
    id: string;
    search_rank_score: number | null;
    local_rank: number | null;
    local_rank_of: number | null;
    gbp_connected: boolean | null;
    bio: string | null;
    slug: string | null;
  };
}) {
  const score = prof.search_rank_score ?? 0;
  const gaps: { label: string; points: number; primary?: boolean }[] = [];
  if (!prof.gbp_connected) {
    gaps.push({
      label: "Connect Google to earn 80 points",
      points: 80,
      primary: true,
    });
  }
  if (!prof.bio || prof.bio.length < 100) {
    gaps.push({ label: "Add a professional bio", points: 25 });
  }
  gaps.push({ label: "Request your first review", points: 40 });

  return (
    <>
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 py-6 text-center">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-2" />
          <h2 className="text-2xl font-semibold">Your profile is live!</h2>
          <p className="text-white/90 text-sm mt-1">
            Welcome to Experience.com.
          </p>
        </div>
        <CardContent className="p-6 text-center">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">
            Your Search Rank Score
          </p>
          <div className="my-3">
            <span className="text-6xl font-bold text-slate-900">{score}</span>
            <span className="text-2xl text-muted-foreground">/850</span>
          </div>
          {prof.local_rank && prof.local_rank_of && (
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
              <TrendingUp className="w-4 h-4" />
              Ranked #{prof.local_rank} of {prof.local_rank_of} in your market
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="font-semibold mb-3">Your top 3 score gaps</h3>
          <div className="space-y-2">
            {gaps.slice(0, 3).map((g, i) => (
              <div
                key={i}
                className={`flex items-center justify-between gap-3 rounded-lg border p-4 ${
                  g.primary
                    ? "border-blue-300 bg-blue-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold ${
                      g.primary
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    +{g.points}
                  </div>
                  <p className="font-medium text-sm">{g.label}</p>
                </div>
                <Button
                  size="sm"
                  variant={g.primary ? "default" : "outline"}
                >
                  {g.primary ? "Connect" : "Start"}
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t flex flex-wrap gap-4">
            <Link
              to="/seat/$kind/$id/interview"
              params={{ kind: "professional", id: prof.id }}
              className="text-sm text-blue-600 hover:underline"
            >
              Start your NORA interview →
            </Link>
            <Link to="/" className="text-sm text-blue-600 hover:underline">
              Go to dashboard →
            </Link>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

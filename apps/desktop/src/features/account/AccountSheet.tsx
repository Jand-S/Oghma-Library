import { ArrowLeft, Mail } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { oghmaAccountStrings as s, accountErrorMessage } from "../../strings/oghmaAccount";
import { Button, CodeInput, Modal, TextField, cx } from "../../ui";
import { suggestEmailFix } from "./emailTypos";
import { ProfileEditor, type ProfileDraft } from "./ProfileEditor";
import type { OghmaAccountController } from "./useOghmaAccount";
import "./oghmaAccount.css";

export type AccountSheetStep = "email" | "code" | "profile";

type AccountSheetProps = {
  account: OghmaAccountController;
  open: boolean;
  onClose: () => void;
  /** "profile" edits the profile of a signed-in reader. */
  initialStep?: AccountSheetStep;
  /** Told once the reader is signed in with a profile (welcome toast, next onboarding step). */
  onDone?: (result: { created: boolean; nickname: string | null }) => void;
};

const STEPS: AccountSheetStep[] = ["email", "code", "profile"];

/**
 * Sign in or create the Oghma account in one flow (like an Apple ID sheet): e-mail → 6-digit
 * code → nickname and avatar (only for a new account, or when editing the profile).
 */
export function AccountSheet({ account, open, onClose, initialStep = "email", onDone }: AccountSheetProps) {
  const [step, setStep] = useState<AccountSheetStep>(initialStep);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [created, setCreated] = useState(false);
  const [draft, setDraft] = useState<{ value: ProfileDraft; valid: boolean } | null>(null);
  const [codeShake, setCodeShake] = useState(0);
  /** The app's secret for this sign-in: with it, confirming the e-mail button finishes here. */
  const [loginId, setLoginId] = useState<string | null>(null);
  const editing = initialStep === "profile";

  useEffect(() => {
    if (!open) return;
    setStep(initialStep);
    setCode("");
    setError(null);
    setBusy(false);
  }, [initialStep, open]);

  // Countdown for "Reenviar em N s".
  useEffect(() => {
    if (step !== "code") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const result = await account.requestCode(email);
    setBusy(false);
    if (!result.ok) {
      setError(accountErrorMessage(result.error));
      if (result.retryAfter) setResendAt(Date.now() + result.retryAfter * 1000);
      return false;
    }
    setEmail(result.email);
    setLoginId(result.loginId);
    setResendAt(Date.now() + result.resendIn * 1000);
    setNow(Date.now());
    return true;
  };

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !email.trim()) return;
    if (await sendCode()) {
      setCode("");
      setStep("code");
    }
  };

  const submitCode = async (value = code) => {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError(null);
    const result = await account.verify(email, value);
    setBusy(false);
    if (!result.ok) {
      const left = result.attemptsLeft;
      setError(`${accountErrorMessage(result.error)}${left ? ` ${s.attemptsLeft(left)}` : ""}`);
      setCode("");
      setCodeShake((value) => value + 1);
      return;
    }
    afterSignIn(result.user, result.created);
  };

  const afterSignIn = (signedIn: { needsProfile: boolean; nickname: string | null }, isNew: boolean) => {
    setCreated(isNew);
    setLoginId(null);
    if (signedIn.needsProfile) {
      setStep("profile");
    } else {
      onDone?.({ created: isNew, nickname: signedIn.nickname });
      onClose();
    }
  };

  // While the code screen is up, confirming "Entrar no Oghma" in the e-mail (on any device)
  // signs this computer in: ask every 2 s.
  const afterSignInRef = useRef(afterSignIn);
  afterSignInRef.current = afterSignIn;
  useEffect(() => {
    if (!open || step !== "code" || !loginId) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void account.pollLogin(email, loginId).then((result) => {
        if (stopped) return;
        if (result.ok) {
          stopped = true;
          window.clearInterval(timer);
          afterSignInRef.current(result.user, result.created);
        } else if (result.error !== "pending") {
          stopped = true;
          window.clearInterval(timer);
        }
      });
    }, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [account, email, loginId, open, step]);

  const saveProfile = async () => {
    if (!draft?.valid || busy) return;
    setBusy(true);
    setError(null);
    const result = await account.updateProfile(draft.value);
    setBusy(false);
    if (!result.ok) {
      setError(accountErrorMessage(result.error));
      return;
    }
    onDone?.({ created, nickname: result.user.nickname });
    onClose();
  };

  const onDraft = useCallback((value: ProfileDraft, valid: boolean) => setDraft({ value, valid }), []);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  // A new account must finish its profile: closing then keeps the random avatar and asks again later.
  const close = () => {
    if (busy) return;
    onClose();
  };

  let title: string = s.emailTitle;
  let description: string = s.emailHint;
  let body = null;
  let footer = null;

  if (step === "email") {
    const fix = suggestEmailFix(email);
    body = (
      <form id="account-email-form" className="account-sheet__form" onSubmit={submitEmail}>
        <TextField
          label={s.emailLabel}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          placeholder={s.emailPlaceholder}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (error) setError(null);
          }}
          leading={<Mail aria-hidden="true" />}
          error={error ?? undefined}
          data-testid="account-email"
        />
        {fix ? (
          <p className="account-sheet__typo" role="status">
            {s.didYouMean}{" "}
            <button type="button" className="account-sheet__typo-fix" onClick={() => setEmail(fix)} data-testid="account-email-fix">
              {fix}
            </button>
            ?
          </p>
        ) : null}
      </form>
    );
    footer = (
      <>
        <Button ref={cancelRef} variant="ghost" onClick={close}>{s.skipForNow}</Button>
        <Button type="submit" form="account-email-form" variant="primary" loading={busy} disabled={!email.trim()} data-testid="account-continue">
          {busy ? s.sending : s.continue}
        </Button>
      </>
    );
  } else if (step === "code") {
    title = s.codeTitle;
    description = s.codeHint(email);
    body = (
      <div className="account-sheet__code">
        <CodeInput
          key={codeShake}
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError(null);
          }}
          onComplete={(value) => void submitCode(value)}
          label={s.codeLabel}
          digitLabel={s.codeDigit}
          invalid={Boolean(error)}
          disabled={busy}
          autoFocus
        />
        <p className={cx("account-sheet__message", error && "is-error")} role={error ? "alert" : "status"}>
          {error ?? (busy ? s.verifying : loginId ? s.orTapButton : "")}
        </p>
        <div className="account-sheet__links">
          <Button size="sm" variant="ghost" icon={<ArrowLeft />} onClick={() => { setStep("email"); setError(null); }}>{s.changeEmail}</Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={resendIn > 0 || busy}
            onClick={() => void sendCode().then((ok) => { if (ok) setError(null); })}
            data-testid="account-resend"
          >
            {resendIn > 0 ? s.resendIn(resendIn) : s.resend}
          </Button>
        </div>
      </div>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={close}>{s.skipForNow}</Button>
        <Button variant="primary" loading={busy} disabled={code.length !== 6} onClick={() => void submitCode()} data-testid="account-verify">
          {s.continue}
        </Button>
      </>
    );
  } else {
    title = editing ? s.editProfileTitle : s.profileTitle;
    description = s.profileHint;
    body = (
      <ProfileEditor
        initial={account.user ?? undefined}
        checkNickname={account.checkNickname}
        onChange={onDraft}
        saveError={error}
      />
    );
    footer = (
      <>
        <Button variant="ghost" onClick={close}>{s.skipForNow}</Button>
        <Button variant="primary" loading={busy} disabled={!draft?.valid} onClick={() => void saveProfile()} data-testid="account-save-profile">
          {busy ? s.saving : editing ? s.saveChanges : s.saveProfile}
        </Button>
      </>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size={step === "profile" ? "md" : "sm"}
      title={title}
      description={description}
      footer={footer}
      dismissible={!busy}
      className={cx("account-sheet", `account-sheet--${step}`)}
    >
      {!editing ? (
        <ol className="account-sheet__dots" aria-label={`Passo ${STEPS.indexOf(step) + 1} de ${STEPS.length}`}>
          {STEPS.map((item) => <li key={item} className={cx(item === step && "is-active")} />)}
        </ol>
      ) : null}
      {body}
    </Modal>
  );
}

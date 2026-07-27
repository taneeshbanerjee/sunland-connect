/**
 * Maps raw Supabase auth errors to clear, user-friendly messages.
 */
export function authErrorMessage(error: unknown): { title: string; description: string } {
  const err = error as { message?: string; status?: number; code?: string } | null;
  const raw = (err?.message ?? "").toLowerCase();
  const code = (err?.code ?? "").toLowerCase();
  const status = err?.status;

  if (!err) return { title: "Something went wrong", description: "Please try again." };

  if (raw.includes("failed to fetch") || raw.includes("network")) {
    return {
      title: "Can't reach the server",
      description: "Check your internet connection and try again in a moment.",
    };
  }
  if (code === "invalid_credentials" || raw.includes("invalid login credentials")) {
    return {
      title: "Incorrect email or password",
      description: "Double-check your details, or use “Forgot password” to reset it.",
    };
  }
  if (raw.includes("email not confirmed")) {
    return {
      title: "Email not confirmed",
      description: "Please confirm your email from the link we sent, then sign in again.",
    };
  }
  if (code === "user_banned" || raw.includes("banned") || raw.includes("blocked")) {
    return {
      title: "Account blocked",
      description: "This account has been disabled. Please contact the society committee.",
    };
  }
  if (status === 429 || raw.includes("rate limit") || raw.includes("too many")) {
    return {
      title: "Too many attempts",
      description: "For your security, please wait a minute before trying again.",
    };
  }
  if (raw.includes("already registered") || code === "user_already_exists") {
    return {
      title: "Account already exists",
      description: "This email is already registered — sign in instead.",
    };
  }
  if (code === "weak_password" || raw.includes("known to be weak") || raw.includes("pwned")) {
    return {
      title: "Password too weak",
      description:
        "That password has appeared in known data breaches. Please choose a longer, unique password.",
    };
  }
  if (raw.includes("password") && raw.includes("should be")) {
    return { title: "Weak password", description: err.message ?? "Choose a stronger password." };
  }
  if (raw.includes("same password") || code === "same_password") {
    return {
      title: "Choose a different password",
      description: "Your new password must be different from the old one.",
    };
  }
  if (raw.includes("expired") || raw.includes("invalid") || code === "otp_expired") {
    return {
      title: "Link expired",
      description: "This reset link is no longer valid. Request a new one.",
    };
  }
  if (status && status >= 500) {
    return {
      title: "Server issue",
      description: "Our servers are having trouble right now. Please try again shortly.",
    };
  }
  return { title: "Something went wrong", description: err.message ?? "Please try again." };
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api";
import { setToken } from "../auth";
import { resetSocket } from "../socket";
import { Button } from "./Button";
import { Input } from "./Input";

export function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token } = await login(username.trim(), password);
      setToken(token);
      resetSocket();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex app-bg text-zinc-200 relative overflow-hidden">
      {/* Decorative orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[480px] h-[480px] bg-hooman-accent/12 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-hooman-cyan/10 rounded-full blur-[80px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-hooman-coral/5 rounded-full blur-[60px]" />
      </div>

      {/* Left: branding (visible on md+) */}
      <div className="hidden md:flex flex-1 flex-col items-center justify-center p-12 relative">
        <div className="max-w-sm text-center">
          <div className="relative inline-block">
            <div className="absolute -inset-4 rounded-3xl bg-gradient-accent/20 blur-2xl" />
            <div className="relative ring-2 ring-white/10 ring-offset-4 ring-offset-transparent rounded-2xl p-1 bg-hooman-surface/60 backdrop-blur-xl">
              <img
                src="/logo.svg"
                alt=""
                className="w-24 h-24 rounded-xl object-contain drop-shadow-lg"
                width={96}
                height={96}
              />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white font-display mt-8 tracking-tight">
            Hooman
          </h1>
          <p className="text-hooman-muted mt-2 text-sm max-w-[240px] mx-auto leading-relaxed">
            Your virtual identity. One place to converse, remember, and get
            things done.
          </p>
        </div>
      </div>

      {/* Right / center: form */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8 relative min-w-0">
        <div className="w-full max-w-sm animate-fade-in-up">
          {/* Mobile: logo + title above form */}
          <div className="md:hidden text-center mb-8">
            <img
              src="/logo.svg"
              alt=""
              className="w-16 h-16 rounded-xl object-contain mx-auto drop-shadow-md"
              width={64}
              height={64}
            />
            <h1 className="text-xl font-bold text-white font-display mt-4">
              Hooman
            </h1>
            <p className="text-xs text-hooman-muted mt-1">
              Sign in to continue
            </p>
          </div>

          <div className="relative rounded-2xl border border-hooman-border/80 bg-hooman-surface/90 backdrop-blur-xl shadow-card p-6 md:p-8 overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-accent" />
            <p className="text-sm font-medium text-hooman-muted mb-5 hidden md:block">
              Sign in
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Username"
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <Input
                label="Password"
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && (
                <p
                  className="text-sm text-hooman-coral flex items-center gap-2 rounded-xl bg-hooman-red/10 border border-hooman-red/20 px-3 py-2"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full"
                disabled={loading}
              >
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

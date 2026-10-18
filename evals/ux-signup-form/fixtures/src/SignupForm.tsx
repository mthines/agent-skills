import { useState } from "react";

export function SignupForm({ onSubmit }: { onSubmit: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await onSubmit(email, password);
    } catch {
      setError(true);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <div style={{ display: "flex" }}>
        <input
          type={showPassword ? "text" : "password"}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ borderColor: error ? "red" : "#ccc" }}
        />
        <div onClick={() => setShowPassword(!showPassword)} style={{ width: 16, height: 16 }}>
          <EyeIcon />
        </div>
      </div>
      {error && <span style={{ color: "red", fontSize: 10 }}>Error</span>}
      <button type="submit">Submit</button>
    </form>
  );
}

function EyeIcon() {
  return <svg viewBox="0 0 16 16" width={16} height={16}><circle cx={8} cy={8} r={3} /></svg>;
}

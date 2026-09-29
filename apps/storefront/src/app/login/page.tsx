import { LoginForm } from "./login-form";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return <LoginForm expired={searchParams["expired"] === "1"} />;
}

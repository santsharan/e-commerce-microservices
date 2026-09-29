"use client";

import { useFormState } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/atoms/button";
import { Field, Panel } from "@/components/molecules/field";
import { loginAction, type FormState } from "@/server/actions";

const initial: FormState = {};

export function LoginForm({ expired }: { expired: boolean }) {
  const [state, action] = useFormState(loginAction, initial);
  return (
    <Panel title="Log in">
      <form action={action} className="space-y-4">
        {expired ? (
          <p className="text-sm text-stone-600">Your session expired. Log in again.</p>
        ) : null}
        <Field label="Email" name="email" type="email" />
        <Field label="Password" name="password" type="password" />
        {state.error === undefined ? null : <p className="text-sm text-rose-700">{state.error}</p>}
        <Button type="submit">Log in</Button>
      </form>
      <p className="text-sm text-stone-600">
        New here? <Link href="/register">Create an account</Link>
      </p>
    </Panel>
  );
}

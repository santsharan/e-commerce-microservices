"use client";

import { useFormState } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/atoms/button";
import { Field, Panel } from "@/components/molecules/field";
import { registerAction, type FormState } from "@/server/actions";

const initial: FormState = {};

export default function RegisterPage() {
  const [state, action] = useFormState(registerAction, initial);
  return (
    <Panel title="Create account">
      <form action={action} className="space-y-4">
        <Field label="Email" name="email" type="email" />
        <Field label="Password" name="password" type="password" hint="At least 12 characters." />
        {state.error === undefined ? null : <p className="text-sm text-rose-700">{state.error}</p>}
        <Button type="submit">Create account</Button>
      </form>
      <p className="text-sm text-stone-600">
        Already registered? <Link href="/login">Log in</Link>
      </p>
    </Panel>
  );
}

import { Alert } from '@/components/ui/alert';

export function FormMessages({ state }: { state: { error?: string; success?: string } }) {
  return (
    <>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-danger">{message}</p> : null;
}

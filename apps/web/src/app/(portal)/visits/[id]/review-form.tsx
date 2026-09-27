'use client';

import { Check, Undo2 } from 'lucide-react';
import { useActionState } from 'react';
import { FieldError, FormMessages } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { FormState } from '@/lib/form-action';
import { reviewVisit } from '../actions';

export function ReviewForm({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reviewVisit, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="visitId" value={visitId} />
      <FormMessages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="comments">Review comments</Label>
        <Textarea id="comments" name="comments" maxLength={2000} defaultValue={state.values?.comments} placeholder="Required when returning it: what must the technician correct?" />
        <FieldError message={state.fieldErrors?.comments} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="APPROVE" disabled={pending}>
          <Check aria-hidden />
          Approve
        </Button>
        <Button type="submit" name="decision" value="REJECT" variant="destructive" disabled={pending}>
          <Undo2 aria-hidden />
          Return for correction
        </Button>
      </div>
    </form>
  );
}

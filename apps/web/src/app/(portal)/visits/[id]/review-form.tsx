'use client';

import { Check, X } from 'lucide-react';
import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { reviewVisit, type ReviewState } from '../actions';

export function ReviewForm({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewVisit, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="visit_id" value={visitId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <div className="space-y-1.5">
        <Label htmlFor="review_comments">Review comments</Label>
        <Textarea id="review_comments" name="review_comments" placeholder="Required when rejecting: what must the technician correct?" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="APPROVED" disabled={pending}>
          <Check aria-hidden />
          Approve
        </Button>
        <Button type="submit" name="decision" value="REJECTED" variant="destructive" disabled={pending}>
          <X aria-hidden />
          Reject
        </Button>
      </div>
    </form>
  );
}

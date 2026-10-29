# Impact case: a bounded refund desk for an independent merchant

## Specific user and problem

The intended user is an independent online merchant who already checks whether a refund is justified, then has to translate a free-form customer/support message into a precise payment action. That text may contain a wrong order, ambiguous amount or an instruction to use a new destination. The business consequence is concrete: a mistaken executable request can refund the wrong payment or create a duplicate before the merchant notices.

This is a target-user hypothesis, not a claim of interviewed customers, adoption, paid pilots or measured savings. No testimonial, transaction volume or time-saving figure has been invented.

## What changes in the workflow

The merchant supplies the authority outside the pasted message: the permitted action, existing trusted order and maximum amount. AI supplies structured claims. Custody checks whether those claims fit the task, canonical PayPal capture and standing refund policy, then records the provider's actual outcome.

The merchant gains a consistent path from request to bounded action and a readable explanation when a check fails. The animation exposes the stored fields and checks rather than generating a reassuring story. A held case can be inspected before any payment writer runs.

## What the evidence supports

One actual owner-authored USD 1.00 refund completed in PayPal sandbox. A subsequent forged-authority reattempt was held against its exhausted balance; an independent PayPal read still showed only the original completed refund. Those historical hosted runs establish the integration and remaining-balance path.

A separate current read-only run used actual model responses and fresh PayPal records for 16 authored cases. All observed expectations were met, including three legitimate controls with no false holds. It made no payment calls. That evidence supports the tested task/destination invariants on those snapshots; it does not establish a universal injection-resistance rate or real commercial fraud prevention.

## Contribution and next validation

The demonstrated contribution is an inspectable boundary that binds proposed actions to a merchant-selected task and canonical payment records, with provider-backed receipts. A model's ability to parse text remains separate from its authority to choose a payment target.

Commercial entitlement still needs merchant verification. A useful next validation is to observe merchants using their own genuine refund requests, with consent, and measure correct task selection, extraction corrections, review time, false holds and recovery from uncertain provider responses. Those outcomes are proposed measurements, not results claimed in this submission.

# M9: The three driving applications, end to end

Spec: `../spec.md`
Status: Planned
Depends on: M8

## Slice

Mail assistant, DM assistant, and job campaign agent each exist as a fixture application: a
topology the checker accepts, and every user flow the spec narrates running end to end against
loopback transports on a disconnected machine — including each flow's "how it ends badly" path.
The stranger's injection mail cannot authorise a reply to its sender; the coworker-tainted DM
egress is denied; the killed submit is terminal indeterminate and never retried. This is the spec's
first design goal made observable, and it is also the evidence-gathering milestone for three open
questions: the taint-reconstruction question (attempt the week-1-note-to-week-6-read
reconstruction on a real multi-week trace), the policy-class question (build the mail memory
bridge and record what it can actually decide), and the binary-artifact question (submit a real
resume and a hostile one through both a parsing and an `opaque` bridge, recording what each
caught).

## Out of scope

- Real providers: no SMTP, no DM platform, no job board. Loopback transports carry the same
  message shapes; AC-6.2 requires exactly this.
- A live model behind `model.infer` — fixture agents are scripted; the request type is declared and
  its recording rules hold. Wiring a real provider is future work under `agent-cli`/harness specs.
- Deciding the three open questions — this milestone produces the evidence; terminology changes or
  policy vocabularies they imply are spec amendments for the owner, not code in this slice.

## Acceptance criteria

| ID      | Criterion                                                                                                                                                                                                     | Serves | Verified by                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| AC-M9.1 | Mail assistant, DM assistant, and job campaign agent each exist as a topology the checker accepts, and each user flow in the spec runs end to end against loopback transports                                 | AC-6.1 | Three fixture applications, run and recorded               |
| AC-M9.2 | No step of AC-M9.1 requires a cloud account, a registered domain, or a deployed service                                                                                                                       | AC-6.2 | The AC-M9.1 run, executed on a disconnected machine        |
| AC-M9.3 | The DM fixture receives a wakeup mid-turn and resumes without restarting the environment                                                                                                                      | AC-5.2 | Journal inspection against the DM fixture                  |
| AC-M9.4 | The mail fixture's stranger flow: the message is admitted as inert content, cannot originate a flow authorising a reply to its sender, the egress is denied on the flow invariant, and the owner notice fires | AC-3.6 | Journal inspection against the mail fixture                |
| AC-M9.5 | The campaign fixture's kill-during-submit flow ends terminal `crossing.indeterminate`, surfaced, never automatically retried                                                                                  | AC-3.5 | Journal inspection against the campaign fixture            |
| AC-M9.6 | Evidence for the taint-reconstruction, policy-class, and binary-artifact open questions is captured in this milestone's QA record                                                                             | AC-6.1 | Recorded reconstruction attempt and bridge comparison runs |

## Audit surface

No new event names — that is itself the check (AC-4.4 holds across all three fixtures). What is
new is scale and correlation: subjects (`thread`, `campaign`, `application-id`) declared in each
topology and carried on events; the campaign's multi-activation trace joined by subject across
flows. Retention: the campaign trace runs clock-advanced across simulated weeks, exercising M8's
bounds against realistic shapes. Never recorded: unchanged — the fixtures plant markers to keep
AC-M8.5's grep honest at application scale.

## Approach

One fixture directory per application, each holding its topology, scripted agents, loopback
transport drivers, and a narrated run script per user flow (including the hostile ones). Build in
spec order — mail, DM, campaign — because each adds one hard thing: mail adds the triage/assistant
split and the reply invariant; DM adds long-running interactivity and mid-turn wakeups; campaign
adds multi-activation subjects, scheduled wakeups, deferral-to-owner, and the irreversible submit.
What could go wrong: a flow the spec narrates may need a concept the platform lacks — that is a
finding against the spec's first design goal and goes to the owner as written, not a thing to
patch around; the disconnected-machine run (AC-M9.2) should be a CI-able mode (no network beyond
loopback), not a one-off manual claim.

## Decisions needed

- Whether webhook-shaped transports appear at all: the spec's open question defers to agent-server
  or an owner ruling. M9 uses loopback transports throughout, which AC-6.1 permits; if the owner
  wants a webhook-shaped fixture, that is scope to add, not assume.
- The evidence from AC-M9.6 will likely demand spec amendments (taint as a mount property? policy
  vocabulary? `opaque` labelling?) — each is an owner decision; write them up in the QA record as
  proposals.

## Verification

1. `pnpm check` — green.
2. Run each fixture's flow scripts in spec order; capture the journal per flow (AC-M9.1).
3. Execute the full set with networking disabled beyond loopback; confirm identical outcomes
   (AC-M9.2).
4. DM: deliver a second message mid-turn; confirm resume without restart (AC-M9.3).
5. Mail: run the stranger flow; confirm inert admission, invariant denial, owner notice (AC-M9.4).
6. Campaign: run the kill-during-submit flow; confirm terminal indeterminate, surfaced, no retry
   (AC-M9.5).
7. Campaign, clock-advanced: attempt the week-1-note reconstruction from the week-6 read without
   foreknowledge of the answer; record honestly whether it succeeded (AC-M9.6). Run the resume
   and hostile resume through parsing and `opaque` submit bridges; record what each caught
   (AC-M9.6). Record what the memory bridge could actually decide (AC-M9.6).

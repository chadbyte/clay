# Project Scheduled Tasks

Project Scheduled Tasks run project work using an explicit **Driver** and **Split Worker** execution pair. They are separate from delayed conversation messages and recurring Mate prompts.

## Create through an interview

1. Select the ordinary project.
2. Open **Scheduled** from the tool palette.
3. Choose **New**.
4. Answer the task interview, including outcome, instructions, timing, and execution pair.
5. Review the prepared task in Scheduled.
6. Select **Create task** yourself.

New interviews use the shared **Default AI**; **Change default** changes that interview choice. The interview prepares a proposal. It does not replace the final human Create task action.

For direct entry, open the menu beside New and choose **Manual creation**.

## Fill the form

Enter **Name** and **Instructions**. Good instructions define the allowed work, checks, and report: “Review new dependency alerts, report actionable changes, and make no commits.”

Set **Date** and **Time**. Times use the **server local timezone** shown in the summary.

- **Repeat** enables a cadence in days, weeks, months, or years. Weekly recurrence selects weekdays.
- **Ends** limits recurrence to a date or occurrence count.
- **Interval** repeats within each active day in minutes or hours, optionally ending after a count or time.
- **Advanced custom schedule** accepts a five-field cron expression.

Read the generated summary before saving. Repeat chooses active days; Interval chooses multiple starts within each active day.

## Configure execution

Choose vendor, model, and supported effort independently for Driver and Split Worker. Both need usable models and tool transport. An installed provider can still be unsuitable for scheduled outcome or pair tools.

**Skip a scheduled start while this task already has an active run** is enabled by default. Turning it off combines overlapping starts into one queued run; it does not launch unlimited parallel copies.

## Operate and inspect

Expand a task to use **Edit**, **Pause/Resume**, **Run now**, **Open run**, or **Delete**. Readiness can show Needs setup or Unavailable. Active runs can show Needs input, Waiting for Worker, or Driver reviewing.

Use **Open blocked run** to answer required input in the actual execution context. A completed Worker is not the same as a completed Driver review.

Pause affects future starts; inspect the active run separately. Delete removes the schedule record, so read its confirmation. Run now still obeys eligibility and overlap controls.

See [Automation overlap](/docs/automation-overlap), [Drivers and Workers](/docs/drivers-workers), and [Loop and Ralph](/docs/loops-and-ralph).

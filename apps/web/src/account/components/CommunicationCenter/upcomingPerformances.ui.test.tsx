import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  OrganizationEvent,
  OrganizationVenue,
} from "@choir/contracts";
import { futureIsoDate, pastIsoDate } from "@choir/testkit";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  filterUpcomingPerformances,
  shouldIncludeUnpublishedUpcomingPerformances,
  validateCommunicationContext,
} from "@choir/domain";
import { MessageComposer } from "./MessageComposer";
import { defaultAudience } from "./utils";

function makeEvent(
  overrides: Partial<OrganizationEvent> & { readonly id: string },
): OrganizationEvent {
  return {
    advancePriceCents: 0,
    callTime: "",
    createdAt: pastIsoDate({ days: 10 }),
    dayOfPriceCents: 0,
    details: "",
    doorsOpenTime: "",
    durationMinutes: 90,
    isCanceled: false,
    isTicketingEnabled: false,
    location: "",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    rsvpDeadlineAt: null,
    rsvpDeadlineDate: null,
    rsvpDeadlinePassed: false,
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    rsvpSelfServiceOpen: true,
    setList: [],
    setListApproved: false,
    setListDefaultTransitionSeconds: 0,
    startsAt: futureIsoDate({ days: 10 }),
    ticketCapacity: null,
    ticketSlug: null,
    title: "Concert",
    type: "Performance",
    updatedAt: pastIsoDate({ days: 5 }),
    venueId: null,
    ...overrides,
  };
}

const venue: OrganizationVenue = {
  address: "500 Concert Blvd",
  createdAt: pastIsoDate({ days: 30 }),
  id: "11111111-1111-4111-8111-111111111111",
  name: "Grand Hall",
  updatedAt: pastIsoDate({ days: 30 }),
};

const internalPerformance = makeEvent({
  id: "22222222-2222-4222-8222-222222222222",
  location: "Local School",
  publishOnWebsite: false,
  startsAt: futureIsoDate({ days: 5 }),
  title: "Internal Outreach Concert",
});

const publishedPerformance = makeEvent({
  id: "33333333-3333-4333-8333-333333333333",
  isTicketingEnabled: true,
  publishOnWebsite: true,
  startsAt: futureIsoDate({ days: 20 }),
  ticketSlug: "season-finale",
  title: "Season Finale",
  venueId: venue.id,
});

function ComposerHarness({
  events,
  initialAudience = defaultAudience,
}: {
  readonly events: readonly OrganizationEvent[];
  readonly initialAudience?: CommunicationAudienceRequest;
}) {
  const [audience, setAudience] = useState<CommunicationAudienceRequest>(initialAudience);
  const [channel, setChannel] = useState<CommunicationChannel>("Email");
  const [subject, setSubject] = useState("Upcoming season");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const upcomingPerformanceCount = filterUpcomingPerformances(events, {
    includeUnpublished: shouldIncludeUnpublishedUpcomingPerformances(audience.targetAudiences),
    nowMs,
  }).length;

  const contextIssues = validateCommunicationContext({
    audience,
    channel,
    contentMarkdown,
    subject,
    upcomingPerformanceCount,
  });

  return (
    <MessageComposer
      audience={audience}
      audienceOptions={["Members", "Contacts", "Ticket Buyers", "Donors"]}
      busy={false}
      channel={channel}
      contactLists={[]}
      contentMarkdown={contentMarkdown}
      contextIssues={contextIssues}
      eventPromotion={null}
      events={events}
      onChannelChange={setChannel}
      onContentChange={setContentMarkdown}
      onOpenReview={vi.fn()}
      onOpenSaveTemplate={vi.fn()}
      onRemoveConflictingPlaceholder={(tag) => {
        setContentMarkdown((prev) => prev.replace(tag, "").trim());
      }}
      onSaveDraft={vi.fn()}
      onSubjectChange={setSubject}
      onToggleRecipientsExpanded={setExpanded}
      onUpdateAudience={(updater) => {
        setAudience((current) => updater(current));
      }}
      reachState={{
        data: {
          audienceOverLimit: false,
          both: 0,
          email: 5,
          sms: 0,
          ticketBuyerPurchasesOverLimit: 0,
          total: 5,
          undeliverableTicketBuyerPurchases: 0,
          unreachable: 0,
        },
        error: null,
        loading: false,
      }}
      recipientsExpanded={expanded}
      rosterConfiguration={null}
      selectedEvent={null}
      subject={subject}
      templates={[]}
      timezone="America/New_York"
      venues={[venue]}
    />
  );
}

describe("Upcoming performances placeholder in MessageComposer", () => {
  it("inserts {{UPCOMING_PERFORMANCES}}, adapts preview to audience visibility, and blocks when none match", async () => {
    const user = userEvent.setup();
    render(<ComposerHarness events={[internalPerformance]} />);

    await user.click(screen.getByText("Insert placeholder"));
    const personalize = screen.getByRole("region", { name: "Personalize message" });
    await user.click(within(personalize).getByRole("button", { name: /Upcoming performances/i }));

    expect(screen.getByRole("textbox", { name: "Message body" })).toHaveValue(
      "{{UPCOMING_PERFORMANCES}} ",
    );
    const preview = screen.getByLabelText("Live formatted message preview");
    expect(preview).toHaveTextContent("Internal Outreach Concert");
    expect(preview).toHaveTextContent("Local School");
    expect(screen.getByRole("button", { name: "Review & send" })).toBeEnabled();

    // Adding Contacts excludes unpublished performance and triggers blocking conflict banner
    await user.click(screen.getByRole("button", { name: "Edit recipients" }));
    await user.click(screen.getByRole("checkbox", { name: "Contacts" }));

    expect(preview).toHaveTextContent("No upcoming performances scheduled.");
    const banner = screen.getByRole("alert", { name: "Message personalization conflict" });
    expect(banner).toHaveTextContent("There are no upcoming published performances scheduled");
    expect(screen.getByRole("button", { name: "Review & send" })).toBeDisabled();

    // Unchecking Contacts restores Members-only visibility and unblocks sending
    await user.click(screen.getByRole("checkbox", { name: "Contacts" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & send" })).toBeEnabled();
  });

  it("previews published performances with venue and ticket links for Members and Contacts", async () => {
    const user = userEvent.setup();
    render(
      <ComposerHarness
        events={[internalPerformance, publishedPerformance]}
        initialAudience={{ ...defaultAudience, targetAudiences: ["Members", "Contacts"] }}
      />,
    );

    await user.click(screen.getByText("Insert placeholder"));
    const personalize = screen.getByRole("region", { name: "Personalize message" });
    await user.click(within(personalize).getByRole("button", { name: /Upcoming performances/i }));

    const preview = screen.getByLabelText("Live formatted message preview");
    expect(preview).not.toHaveTextContent("Internal Outreach Concert");
    expect(preview).toHaveTextContent("Season Finale");
    expect(preview).toHaveTextContent("Grand Hall, 500 Concert Blvd");
    expect(within(preview).getByRole("link", { name: "Buy tickets" })).toHaveAttribute(
      "href",
      "/tickets/season-finale",
    );
    expect(screen.getByRole("button", { name: "Review & send" })).toBeEnabled();
  });

  it("dynamically updates upcoming performances preview when events change or are removed", async () => {
    const user = userEvent.setup();
    const removedPerformance = makeEvent({
      id: "44444444-4444-4444-8444-444444444444",
      location: "Town Square",
      publishOnWebsite: false,
      startsAt: futureIsoDate({ days: 12 }),
      title: "Holiday Parade",
    });
    const keptPerformance = makeEvent({
      id: "55555555-5555-4555-8555-555555555555",
      location: "Fairfield Christian Church",
      publishOnWebsite: false,
      startsAt: futureIsoDate({ days: 15 }),
      title: "Christmas Concert",
    });

    const { rerender } = render(<ComposerHarness events={[removedPerformance, keptPerformance]} />);

    await user.click(screen.getByText("Insert placeholder"));
    const personalize = screen.getByRole("region", { name: "Personalize message" });
    await user.click(within(personalize).getByRole("button", { name: /Upcoming performances/i }));

    const preview = screen.getByLabelText("Live formatted message preview");
    expect(preview).toHaveTextContent("Holiday Parade");
    expect(preview).toHaveTextContent("Christmas Concert");

    // Parent updates events (e.g. user removed Holiday Parade and added a new tour stop)
    const newPerformance = makeEvent({
      id: "66666666-6666-4666-8666-666666666666",
      location: "Kingsbury Senior Living",
      publishOnWebsite: false,
      startsAt: futureIsoDate({ days: 18 }),
      title: "Kingsbury - Nursing Home Tour",
    });

    rerender(<ComposerHarness events={[keptPerformance, newPerformance]} />);

    expect(preview).not.toHaveTextContent("Holiday Parade");
    expect(preview).toHaveTextContent("Christmas Concert");
    expect(preview).toHaveTextContent("Kingsbury - Nursing Home Tour");
  });
});

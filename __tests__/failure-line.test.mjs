import { describe, it, expect } from "vitest";
import { failureLine, inviteFailureLine } from "../src/logic.js";

const err = (props, message = "hub text") => Object.assign(new Error(message), props);
const words = { action: "save the check-in", thing: "check-in" };

describe("failureLine", () => {
  it("names a duplicate by code, or by the hub's text while production lags", () => {
    expect(failureLine(err({ status: 400, code: "UNIQUE_CONSTRAINT" }), words)).toBe("That check-in already exists.");
    expect(failureLine(err({ status: 400 }, "UNIQUE constraint failed: x.id"), words)).toBe("That check-in already exists.");
  });
  it("names a refusal without asking for a retry", () => {
    expect(failureLine(err({ status: 403 }), words)).toBe("You don’t have permission to save the check-in.");
    expect(failureLine(err({ status: 507 }), words)).toBe("The household’s storage is full — free up space first.");
    expect(failureLine(err({ status: 429 }), words)).toBe("Too many tries — wait a minute and try again.");
  });
  it("splits a write that changed nothing by the caller's re-read", () => {
    expect(failureLine(null, { ...words, found: false })).toBe("This check-in has been removed.");
    expect(failureLine(null, { ...words, found: true })).toBe("You don’t have permission to save the check-in.");
  });
  it("reads a 404 as removed and a bare 409 as changed when there is no re-read", () => {
    expect(failureLine(err({ status: 404 }), words)).toBe("This check-in has been removed.");
    expect(failureLine(err({ status: 409 }), words)).toBe("This check-in was changed by someone else — check it first.");
  });
  it("asks for a retry only when retrying can work", () => {
    for (const e of [err({}), err({ status: 500 }), err({ status: 502 }), err({ status: 400 }), new TypeError("Failed to fetch"), undefined, null]) {
      expect(failureLine(e, words)).toBe("Couldn’t save the check-in — try again.");
    }
  });
  it("keeps a line the app wrote for the user, and never shows hub text", () => {
    expect(failureLine(err({ forUser: true }, "Choose who is checking in."), words)).toBe("Choose who is checking in.");
    expect(failureLine(err({ status: 500 }, "D1_ERROR: boom"), words)).not.toMatch(/D1_ERROR/);
  });
});

// The hub's answers, from external-contacts-protocol.ts: 403 adult gate, 429 monthly
// quota, 409 for every refusal inviteExternalContact throws, 502 a failed send.
describe("inviteFailureLine", () => {
  it("gives the refusals a person can act on a line of their own", () => {
    expect(inviteFailureLine(err({ status: 403 }, "Only adults can manage external contacts"))).toBe("Only adults can add external contacts.");
    expect(inviteFailureLine(err({ status: 429 }, "Monthly email limit reached"))).toBe("The household has reached this month’s email limit.");
    expect(inviteFailureLine(err({ status: 409 }, "This address has unsubscribed from this household"))).toBe("That address has unsubscribed from this household’s emails.");
    expect(inviteFailureLine(err({ status: 409 }, "External contact limit reached (100)"))).toBe("The household has reached its limit of external contacts. Remove one that is no longer needed first.");
    expect(inviteFailureLine(err({ status: 409 }, "External contact record limit reached (500); remove old contacts before inviting another")))
      .toBe("The household has reached its limit of external contacts. Remove one that is no longer needed first.");
  });
  it("decides a 409 by its code first", () => {
    expect(inviteFailureLine(err({ status: 409, code: "unsubscribed" }, "x"))).toBe("That address has unsubscribed from this household’s emails.");
    expect(inviteFailureLine(err({ status: 409, code: "contact_limit" }, "x"))).toBe("The household has reached its limit of external contacts. Remove one that is no longer needed first.");
    expect(inviteFailureLine(err({ status: 409, code: "contact_changed" }, "This contact changed while the invite was being refreshed; retry")))
      .toBe("Couldn’t send the confirmation email — try again.");
    // The code wins over the text.
    expect(inviteFailureLine(err({ status: 409, code: "contact_changed" }, "unsubscribed limit"))).toBe("Couldn’t send the confirmation email — try again.");
  });
  // An older hub answered 409 with no code for every throw of its invite.
  it("asks for a retry on a codeless 409 that names neither refusal (a racing invite, a database failure)", () => {
    expect(inviteFailureLine(err({ status: 409 }, "This contact changed while the invite was being refreshed; retry")))
      .toBe("Couldn’t send the confirmation email — try again.");
    expect(inviteFailureLine(err({ status: 409 }, "D1_ERROR: boom"))).toBe("Couldn’t send the confirmation email — try again.");
  });
  it("asks for a retry when the send failed or nothing answered", () => {
    for (const e of [err({ status: 502 }, "Resend: boom"), err({ status: 500 }, "Failed to add contact"), err({ status: 400 }, "A valid email is required"), new TypeError("Failed to fetch")]) {
      expect(inviteFailureLine(e)).toBe("Couldn’t send the confirmation email — try again.");
    }
  });
  it("never shows the hub's text", () => {
    expect(inviteFailureLine(err({ status: 502 }, "Resend: boom"))).not.toMatch(/Resend/);
  });
});

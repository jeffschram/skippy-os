import { describe, expect, it } from "vitest";
import { iconKind } from "./item-icon";

describe("the icon before an item", () => {
  it("is worked out from the item's words", () => {
    expect(iconKind("Flight home — departs 12:00pm")).toBe("flight");
    expect(iconKind("JetBlue 65 JFK → ABQ")).toBe("flight");
    expect(iconKind("Leave for the airport", "Home → County Airport (HPN)")).toBe("flight");
    expect(iconKind("Uber to JFK Terminal 5")).toBe("ride");
    expect(iconKind("Book the car service for Sunday")).toBe("ride");
    expect(iconKind("Dinner reservation at a new place")).toBe("food");
    expect(iconKind("Pizza lunch at the park")).toBe("food");
    expect(iconKind("Book the hotel for three nights")).toBe("lodging");
    expect(iconKind("Follow-up appointment")).toBe("health");
    expect(iconKind("Pay the electric bill")).toBe("money");
    expect(iconKind("Mortgage due")).toBe("money");
    expect(iconKind("Package arriving today")).toBe("package");
    expect(iconKind("Movie night")).toBe("film");
    expect(iconKind("Mom's birthday")).toBe("birthday");
    expect(iconKind("Jury duty")).toBe("court");
  });

  it("goes by whole words", () => {
    expect(iconKind("Barber at 12:45")).toBe("haircut");
    expect(iconKind("Run the setup again")).toBeUndefined();
    // "as 30" is not a flight number, and an inn in a restaurant's name is not a hotel.
    expect(iconKind("Record the songs as 30-second shorts")).toBe("music");
    expect(iconKind("Dinner reservation: Inn of the Seventh Ray")).toBe("food");
  });

  it("is left to the item's kind when nothing matches", () => {
    expect(iconKind("Think it over")).toBeUndefined();
  });
});

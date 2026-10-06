import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakePlaceSearch } from "../test/fakeMaps";
import { PlaceSearchBox } from "./PlaceSearchBox";

describe("PlaceSearchBox", () => {
  it("closes the list after a pick, and does not search for the picked name", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const suggest = vi.spyOn(fakePlaceSearch, "suggest");
    render(<PlaceSearchBox label="From" search={fakePlaceSearch} onPick={onPick} />);

    await user.type(screen.getByRole("combobox", { name: "From" }), "Big Ben");
    await user.click(await screen.findByRole("option", { name: "Big Ben, London" }));

    await waitFor(() => { expect(onPick).toHaveBeenCalledWith({ lat: 51.5007, lng: -0.1246 }, "Big Ben"); });
    expect(screen.getByRole("combobox", { name: "From" })).toHaveValue("Big Ben");
    const calls = suggest.mock.calls.length;
    // Longer than the 250 ms debounce, so a search for the picked name would have run.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(suggest.mock.calls.length).toBe(calls);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // Typing again searches as before.
    await user.type(screen.getByRole("combobox", { name: "From" }), " Tower");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    suggest.mockRestore();
  });
});

import { render, screen } from "@testing-library/react";
import App from "./App";
import { ThemeProvider } from "./components/ThemeProvider";

describe("App shell", () => {
  it("renders the Dusk shell with treemap canvas mounted", () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    expect(screen.getByText("Disk Atlas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan Folder" })).toBeInTheDocument();
    // TreemapCanvas renders its initializing overlay while the async renderer boots.
    expect(screen.getByText("Benchmarking renderer…")).toBeInTheDocument();
  });
});

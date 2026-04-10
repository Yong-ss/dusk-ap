import { render, screen } from "@testing-library/react";
import App from "./App";
import { ThemeProvider } from "./components/ThemeProvider";

describe("App shell", () => {
  it("renders the Dusk Phase 1 shell", () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    expect(screen.getByText("Disk Atlas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan Folder" })).toBeInTheDocument();
    expect(screen.getByText("Treemap canvas mounts here")).toBeInTheDocument();
  });
});

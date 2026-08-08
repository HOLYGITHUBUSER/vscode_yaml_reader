import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

class TestResizeObserver implements ResizeObserver {
  public constructor(
    private readonly callback: ResizeObserverCallback
  ) {}

  public disconnect(): void {
    // No browser layout engine exists in jsdom.
  }

  public observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: target.getBoundingClientRect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: []
        }
      ],
      this
    );
  }

  public unobserve(): void {
    // No browser layout engine exists in jsdom.
  }
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: TestResizeObserver
});

afterEach(() => {
  cleanup();
});

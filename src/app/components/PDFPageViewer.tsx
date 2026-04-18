"use client";

import { useEffect, useRef, useState } from "react";

type PDFDocumentProxy = { getPage(n: number): Promise<PDFPageProxy>; destroy(): void };
type PDFPageProxy = {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: object): { promise: Promise<void> };
};

// Shared document instance — avoids reloading and reparsing the PDF per component
let sharedDocPromise: Promise<PDFDocumentProxy> | null = null;

function getSharedPdfDoc(): Promise<PDFDocumentProxy> {
  if (!sharedDocPromise) {
    sharedDocPromise = import("pdfjs-dist").then(({ getDocument, GlobalWorkerOptions }) => {
      GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
      return getDocument("/CFS.pdf").promise as Promise<PDFDocumentProxy>;
    });
  }
  return sharedDocPromise;
}

type Props = { pageNumber: number };

export default function PDFPageViewer({ pageNumber }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdf = await getSharedPdfDoc();
        if (cancelled) return;

        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (!cancelled) setLoading(false);
      } catch (e: unknown) {
        if (!cancelled) {
          setError("Failed to render page.");
          setLoading(false);
          console.error(e);
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [pageNumber]);

  if (error)
    return (
      <p
        className="text-xs px-4 py-3"
        style={{ color: "var(--accent-amber)", fontFamily: "inherit" }}
      >
        ✗ {error}
      </p>
    );

  return (
    <div className="relative" style={{ background: "var(--surface)" }}>
      {loading && (
        <div
          className="flex items-center gap-2 px-4 py-3 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="blink" style={{ color: "var(--accent-cyan)" }}>
            ▶
          </span>
          Rendering page {pageNumber}…
        </div>
      )}
      <canvas ref={canvasRef} className="w-full" style={{ display: loading ? "none" : "block" }} />
    </div>
  );
}

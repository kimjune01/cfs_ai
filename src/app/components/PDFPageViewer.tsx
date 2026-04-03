"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  pageNumber: number;
};

export default function PDFPageViewer({ pageNumber }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

        const pdf = await pdfjsLib.getDocument("/CFS.pdf").promise;
        if (cancelled) return;

        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: canvas.getContext("2d")!,
          viewport,
          canvas,
        }).promise;

        if (!cancelled) setLoading(false);
      } catch (e: unknown) {
        if (!cancelled) {
          setError("Failed to render page.");
          setLoading(false);
          console.error(e);
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [pageNumber]);

  if (error) return <p className="text-xs text-red-400 px-2">{error}</p>;

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 text-xs text-gray-400">
          Rendering page {pageNumber}…
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full border border-gray-200 rounded"
        style={{ display: loading ? "none" : "block" }}
      />
    </div>
  );
}

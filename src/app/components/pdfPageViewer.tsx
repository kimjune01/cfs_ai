"use client";

import { useEffect, useRef, useState } from "react";

type PDFDocumentProxy = { getPage(n: number): Promise<PDFPageProxy>; destroy(): void };
type PDFPageProxy = {
    getViewport(opts: { scale: number }): { width: number; height: number };
    render(opts: object): { promise: Promise<void> };
};

// Shared document instance — avoids reloading and reparsing the PDF per component
let sharedDocPromise: Promise<PDFDocumentProxy> | null = null;

const getSharedPdfDoc = (): Promise<PDFDocumentProxy> => {
    if (!sharedDocPromise) {
        sharedDocPromise = import("pdfjs-dist").then(({ getDocument, GlobalWorkerOptions }) => {
            GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
            return getDocument("/CFS.pdf").promise;
        });
    }
    return sharedDocPromise;
};

type Props = { pageNumber: number };

const PDFPageViewer = ({ pageNumber }: Props) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const render = async () => {
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
        };

        void render();
        return () => {
            cancelled = true;
        };
    }, [pageNumber]);

    if (error) return <p className="pdf-error text-xs px-4 py-3">✗ {error}</p>;

    return (
        <div className="pdf-container relative">
            {loading && (
                <div className="pdf-loading flex items-center gap-2 px-4 py-3 text-xs">
                    <span className="pdf-loading-arrow blink">▶</span>
                    Rendering page {pageNumber}…
                </div>
            )}
            <canvas
                ref={canvasRef}
                className="w-full"
                style={{ display: loading ? "none" : "block" }}
            />
        </div>
    );
};

export default PDFPageViewer;

'use client';

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DEFAULT_VOICE, voiceOptions } from "./constants";

/* ===============================
   Types
================================ */

interface TextSegment {
    text: string;
    segmentIndex: number;
    pageNumber?: number;
    wordCount: number;
}

/* ===============================
   Tailwind Utility
================================ */

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/* ===============================
   Serialize Mongo Data
================================ */

export const serializeData = <T>(data: T): T => JSON.parse(JSON.stringify(data));

/* ===============================
   Slug Generator
================================ */

export function generateSlug(text: string): string {
    return text
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ===============================
   Regex Escape (Security)
================================ */

export const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/* ===============================
   Text Segmentation
================================ */

export const splitIntoSegments = (
    text: string,
    segmentSize: number = 500,
    overlapSize: number = 50
): TextSegment[] => {
    if (segmentSize <= 0) throw new Error("segmentSize must be greater than 0");

    if (overlapSize < 0 || overlapSize >= segmentSize) throw new Error(
        "overlapSize must be >= 0 and < segmentSize"
    );

    const words = text.split(/\s+/).filter(Boolean);
    const segments: TextSegment[] = [];

    let segmentIndex = 0;
    let startIndex = 0;

    while (startIndex < words.length) {
        const endIndex = Math.min(
            startIndex + segmentSize,
            words.length
        );

        const segmentWords = words.slice(startIndex, endIndex);

        segments.push({
            text: segmentWords.join(" "),
            segmentIndex,
            wordCount: segmentWords.length,
        });

        segmentIndex++;

        if (endIndex >= words.length) break;

        startIndex = endIndex - overlapSize;
    }

    return segments;
};

/* ===============================
   Voice Resolver
================================ */

export const getVoice = (persona?: string) => {
    if (!persona) return voiceOptions[DEFAULT_VOICE];

    const voiceEntry = Object.values(voiceOptions).find(
        (v) => v.id === persona
    );
    if (voiceEntry) return voiceEntry;

    const voiceByKey =
        voiceOptions[persona as keyof typeof voiceOptions];
    if (voiceByKey) return voiceByKey;

    return voiceOptions[DEFAULT_VOICE];
};

/* ===============================
   Duration Formatter
================================ */

export const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    return `${mins}:${secs.toString().padStart(2, "0")}`;
};

/* ===============================
   PDF Parser (Optimized)
================================ */

export async function parsePDFFile(file: File) {
    try {
        const pdfjsLib = await import("pdfjs-dist");

        if (typeof window !== "undefined") {
            pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
                "pdfjs-dist/build/pdf.worker.min.mjs",
                import.meta.url
            ).toString();
        }

        const arrayBuffer = await file.arrayBuffer();

        const loadingTask = pdfjsLib.getDocument({
            data: arrayBuffer,
        });

        const pdfDocument = await loadingTask.promise;

        /* ===============================
        Generate Cover Image
        ============================== */

        const firstPage = await pdfDocument.getPage(1);

        const viewport = firstPage.getViewport({
            scale: 1.5, // optimized quality/performance
        });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error("Could not get canvas context");
        }

        await firstPage.render({
            canvas,
            canvasContext: context,
            viewport,
        }).promise;

        const coverDataURL = canvas.toDataURL("image/png");

        firstPage.cleanup();

        /* ===============================
        Stream Text Extraction
        ============================== */

        const segments: TextSegment[] = [];
        let globalSegmentIndex = 0;

        for (
            let pageNum = 1;
            pageNum <= pdfDocument.numPages;
            pageNum++
        ) {
            const page = await pdfDocument.getPage(pageNum);

            const textContent = await page.getTextContent();

            const pageText = textContent.items
                .filter((item) => "str" in item)
                .map((item) => (item as { str: string }).str)
                .join(" ");

            const pageSegments = splitIntoSegments(pageText);

            for (const seg of pageSegments) {
                segments.push({
                    ...seg,
                    segmentIndex: globalSegmentIndex++,
                    pageNumber: pageNum,
                });
            }

            // release memory early
            page.cleanup();
        }

        await pdfDocument.destroy();

        return {
            content: segments,
            cover: coverDataURL,
        };
    } catch (error) {
        console.error("Error parsing PDF:", error);

        throw new Error(`Failed to parse PDF file: ${
            error instanceof Error
            ? error.message
            : String(error)
        }`);
    }
}
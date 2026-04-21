import "./globals.css";

import type { Metadata } from "next";
import { Barlow_Condensed, JetBrains_Mono } from "next/font/google";

const jetbrainsMono = JetBrains_Mono({
    variable: "--font-jetbrains",
    subsets: ["latin"],
    weight: ["400", "500"],
});

const barlowCondensed = Barlow_Condensed({
    variable: "--font-barlow",
    subsets: ["latin"],
    weight: ["400", "600"],
});

export const metadata: Metadata = {
    title: "CFS/AI · British Columbia",
    description: "Canadian Flight Supplement British Columbia AI Assistant",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => (
    <html
        lang="en"
        className={`${jetbrainsMono.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
        <body className="min-h-full flex flex-col">{children}</body>
    </html>
);

export default RootLayout;

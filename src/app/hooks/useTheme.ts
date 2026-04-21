"use client";

import { useEffect, useState } from "react";

const useTheme = () => {
    const [dark, setDark] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem("theme");
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setDark(stored ? stored === "dark" : prefersDark);
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        localStorage.setItem("theme", dark ? "dark" : "light");
    }, [dark]);

    const toggle = () => setDark((prev) => !prev);

    return { dark, toggle };
};

export { useTheme };

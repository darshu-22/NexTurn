"use client";

import React, { useEffect, useState, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (queueId: string) => void;
}

export default function QRScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
}: QRScannerModalProps) {
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [manualError, setManualError] = useState("");
  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);
  const isScanningRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;

    setScannerError(null);
    setManualError("");

    const elementId = "nexturn-qr-reader";

    const startScanner = async () => {
      try {
        // Initialize Html5Qrcode
        const html5Qrcode = new Html5Qrcode(elementId);
        html5QrcodeRef.current = html5Qrcode;

        await html5Qrcode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText: string) => {
            // Stop scanning once code is detected
            if (isScanningRef.current) {
              isScanningRef.current = false;
              html5Qrcode
                .stop()
                .then(() => {
                  processScannedText(decodedText);
                })
                .catch(() => {
                  processScannedText(decodedText);
                });
            }
          },
          () => {
            // Ignore frame scan errors
          },
        );

        isScanningRef.current = true;
      } catch (err: any) {
        console.error("Camera access error:", err);
        setScannerError(
          "Camera access denied or unavailable. Please grant camera permission or use manual entry below.",
        );
      }
    };

    // Small delay to ensure DOM element rendered
    const timer = setTimeout(() => {
      startScanner();
    }, 200);

    return () => {
      clearTimeout(timer);
      if (html5QrcodeRef.current && isScanningRef.current) {
        isScanningRef.current = false;
        html5QrcodeRef.current.stop().catch(() => {});
      }
    };
  }, [isOpen]);

  const processScannedText = (text: string) => {
    let queueId = text.trim();
    if (queueId.includes("/queue/")) {
      const parts = queueId.split("/queue/");
      queueId = parts[1].split("?")[0].split("#")[0];
    }
    if (queueId) {
      onScanSuccess(queueId);
    } else {
      setScannerError(
        "Invalid QR code format. Could not detect a valid Queue ID.",
      );
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManualError("");

    let val = manualInput.trim();
    if (!val) {
      setManualError("Please enter a valid Queue ID or URL.");
      return;
    }

    if (val.includes("/queue/")) {
      const parts = val.split("/queue/");
      val = parts[1].split("?")[0].split("#")[0];
    }

    if (val) {
      if (html5QrcodeRef.current && isScanningRef.current) {
        isScanningRef.current = false;
        html5QrcodeRef.current.stop().catch(() => {});
      }
      onScanSuccess(val);
    } else {
      setManualError("Could not extract a valid Queue ID from the input.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-xl">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v1m0 14v1m8-8h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Scan Queue QR</h2>
              <p className="text-xs text-slate-400">
                Point device camera at NexTurn QR code
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full transition"
            aria-label="Close modal"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Camera Viewfinder */}
          <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 min-h-[280px] flex items-center justify-center">
            <div
              id="nexturn-qr-reader"
              className="w-full h-full text-slate-400"
            ></div>

            {scannerError && (
              <div className="absolute inset-0 p-5 bg-slate-950/95 flex flex-col items-center justify-center text-center space-y-3 z-10">
                <div className="p-3 bg-rose-500/20 text-rose-400 rounded-full">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-8 w-8"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <p className="text-sm font-medium text-rose-300">
                  {scannerError}
                </p>
                <p className="text-xs text-slate-400 max-w-xs">
                  Please enable camera permission in your browser settings or
                  use manual link entry below.
                </p>
              </div>
            )}
          </div>

          {/* Manual Fallback Entry */}
          <div className="pt-2 border-t border-slate-800 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Manual Fallback Link / ID
            </label>
            <form onSubmit={handleManualSubmit} className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Paste URL or Queue ID (e.g. queue-123)"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-xl transition"
                >
                  Open Queue
                </button>
              </div>
              {manualError && (
                <p className="text-xs text-rose-400">{manualError}</p>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StoreConnect } from "@/components/store-connect";
import { IconPlus } from "@/components/icons";

export function ConnectStoreButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <IconPlus className="h-4 w-4" /> Connect store
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()} className="animate-fade-up">
            <StoreConnect onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

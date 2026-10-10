/** Desktop mode's way into Big Picture, in the top bar beside Settings. */
import { Gamepad2 } from "lucide-react";
import { openBigPicture } from "./mode";

export function BigPictureButton() {
  return (
    <button className="icon" aria-label="Big Picture" title="Big Picture (controller mode)" onClick={openBigPicture}>
      <Gamepad2 size={18} />
    </button>
  );
}

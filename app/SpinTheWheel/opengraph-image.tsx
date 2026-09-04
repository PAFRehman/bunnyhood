import {
  renderSpinSocialCard,
  spinSocialImageAlt,
  spinSocialImageSize,
} from "./social-card";

export const alt = spinSocialImageAlt;
export const size = spinSocialImageSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return renderSpinSocialCard();
}

import { ref } from "vue";
import { useIntersectionObserver } from "@vueuse/core";
import { Ref, watch } from "vue";

export default function useVisibility(
  elem: Ref<HTMLElement | null>,
  callback: (state: boolean) => void
) {
  const visible = ref(false);

  // threshold: @vueuse/core 8 defaulted to 0.1, 15 defaults to 0. Pinned to the
  // old value so the callback fires at the same points.
  useIntersectionObserver(
    elem,
    ([{ isIntersecting }], observerElement) => {
      visible.value = isIntersecting;
    },
    { threshold: 0.1 }
  );

  watch(
    () => visible.value,
    (newVal) => {
      callback(newVal);
    }
  );
}

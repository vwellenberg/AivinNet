<template>
  <div class="clientreset">
    <!-- The label is the label. It used to be padded with four &nbsp; — spacing
         written as content, while `btn-pill` already carries `padding: 0 $medium`
         like every other pill in the app. -->
    <button class="btn-pill" @click="resetClient">Reset client</button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();

const resetClient = () => {
  localStorage.clear();
  router.go(0);
};
</script>

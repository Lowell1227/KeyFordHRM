<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { SCORE_MIN, SCORE_MAX, SCORE_STEP, getScoreOutOfRangeMessage } from '@/utils/score';

const props = withDefaults(
  defineProps<{
    modelValue?: number | null;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    placeholder?: string;
    size?: 'small' | 'default' | 'large';
  }>(),
  {
    min: SCORE_MIN,
    max: SCORE_MAX,
    step: SCORE_STEP,
    placeholder: '请输入分数',
    size: 'default',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void;
  (e: 'change', value: number | null): void;
}>();

const innerValue = ref<number | undefined>(props.modelValue ?? undefined);
const error = ref<string | null>(null);

watch(
  () => props.modelValue,
  (val) => {
    innerValue.value = val ?? undefined;
    error.value = null;
  },
);

const minVal = computed(() => props.min ?? SCORE_MIN);
const maxVal = computed(() => props.max ?? SCORE_MAX);
const stepVal = computed(() => props.step ?? SCORE_STEP);

function validate(value?: number): boolean {
  if (value == null) {
    error.value = null;
    return true;
  }
  const msg = getScoreOutOfRangeMessage(value);
  if (msg) {
    error.value = msg;
    ElMessage.warning(msg);
    return false;
  }
  if (value < minVal.value) {
    error.value = `分数不能低于 ${minVal.value}`;
    ElMessage.warning(error.value);
    return false;
  }
  if (value > maxVal.value) {
    error.value = `分数不能高于 ${maxVal.value}`;
    ElMessage.warning(error.value);
    return false;
  }
  error.value = null;
  return true;
}

function onInput(value: number | string | null | undefined) {
  if (value == null || value === '') {
    error.value = null;
    emit('update:modelValue', null);
    return;
  }
  const num = typeof value === 'string' ? parseFloat(value) : value;
  const msg = getScoreOutOfRangeMessage(num);
  error.value = msg;
  if (!msg) {
    emit('update:modelValue', Math.round(num * 10) / 10);
  }
}

function onChange(value: number | string | null | undefined) {
  if (value == null || value === '') {
    innerValue.value = undefined;
    emit('update:modelValue', null);
    emit('change', null);
    return;
  }
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (!validate(num)) return;
  innerValue.value = num;
  emit('update:modelValue', num);
  emit('change', num);
}

const sizeClass = computed(() => ({
  'score-input--small': props.size === 'small',
  'score-input--large': props.size === 'large',
}));
</script>

<template>
  <div class="score-input" :class="sizeClass">
    <el-input-number
      v-model="innerValue"
      :min="minVal"
      :max="maxVal"
      :step="stepVal"
      :disabled="disabled"
      :placeholder="placeholder"
      :precision="1"
      :controls="true"
      class="score-input__control"
      @input="onInput"
      @change="onChange"
    />
    <span v-if="error" class="score-input__error">{{ error }}</span>
  </div>
</template>

<style scoped>
.score-input {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
}

.score-input__control {
  min-height: 44px;
}

.score-input__control :deep(.el-input__inner) {
  min-height: 44px;
}

.score-input__error {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.4;
}

.score-input--small .score-input__control,
.score-input--small .score-input__control :deep(.el-input__inner) {
  min-height: 36px;
}

.score-input--large .score-input__control,
.score-input--large .score-input__control :deep(.el-input__inner) {
  min-height: 48px;
}
</style>

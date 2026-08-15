<script setup lang="ts">
import { computed, ref } from 'vue';
import type { GoalTrackingPeopleGroup } from './goal-tracking';
import { parseCollapsedPeopleGroups } from './goal-tracking';

const COLLAPSED_KEY = 'kayford.goalTracking.collapsedPeopleGroups';

const props = defineProps<{
  groups: GoalTrackingPeopleGroup[];
  selectedId: string;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const keyword = ref('');
const collapsed = ref(parseCollapsedPeopleGroups(localStorage.getItem(COLLAPSED_KEY)));
const filteredGroups = computed(() => props.groups.map((group) => ({
  ...group,
  people: group.people.filter((person) => person.name.includes(keyword.value.trim())),
})));
const noMatches = computed(() => filteredGroups.value.every((group) => group.people.length === 0));

function toggleGroup(key: 'self' | 'manager') {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] };
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed.value));
}
</script>

<template>
  <section class="tracking-people" data-testid="goal-tracking-people" aria-label="目标跟进人员">
    <label class="tracking-people__search">
      <span class="visually-hidden">搜索员工</span>
      <input
        v-model="keyword"
        type="search"
        placeholder="搜索员工"
        data-testid="goal-tracking-person-search"
      >
      <span aria-hidden="true">⌕</span>
    </label>

    <div class="tracking-people__groups">
      <section
        v-for="group in filteredGroups"
        :key="group.key"
        class="tracking-people__group"
        :data-testid="`goal-tracking-group-${group.key}`"
        :data-collapsed="String(Boolean(collapsed[group.key]))"
      >
        <h2>
          <button
            type="button"
            class="tracking-people__group-toggle"
            :aria-expanded="!collapsed[group.key]"
            :aria-label="`${collapsed[group.key] ? '展开' : '收起'}${group.label}`"
            @click="toggleGroup(group.key)"
          >
            <span>{{ group.label }}</span>
            <span class="tracking-people__chevron" aria-hidden="true">⌃</span>
          </button>
        </h2>
        <div v-show="!collapsed[group.key]" class="goal-people-list">
          <button
            v-for="person in group.people"
            :key="person.id"
            type="button"
            class="goal-person-item tracking-people__person"
            :class="{ 'is-active': person.id === selectedId, 'is-selected': person.id === selectedId }"
            :aria-pressed="person.id === selectedId"
            @click="emit('select', person.id)"
          >
            <span class="tracking-people__avatar" aria-hidden="true">
              <img v-if="person.avatarUrl" :src="person.avatarUrl" alt="">
              <span v-else>{{ person.name.slice(0, 1) }}</span>
            </span>
            <span>{{ person.name }}</span>
          </button>
        </div>
      </section>
      <p v-if="noMatches" class="tracking-people__empty">未找到匹配人员</p>
    </div>
  </section>
</template>

<style scoped>
.tracking-people {
  height: 100%;
  padding: 16px 10px;
  overflow: auto;
  color: #253047;
}

.tracking-people__search {
  position: relative;
  display: block;
  margin-bottom: 14px;
}

.tracking-people__search input {
  width: 100%;
  height: 34px;
  padding: 0 34px 0 10px;
  border: 1px solid #dfe4ec;
  border-radius: 5px;
  outline: none;
  color: inherit;
  background: #fff;
  font: inherit;
  font-size: 13px;
}

.tracking-people__search input:focus {
  border-color: #4d91ff;
  box-shadow: 0 0 0 2px rgb(77 145 255 / 12%);
}

.tracking-people__search > span:last-child {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  color: #8f99ab;
  font-size: 18px;
}

.tracking-people__group + .tracking-people__group {
  margin-top: 12px;
}

.tracking-people__group h2 {
  min-height: 28px;
  display: flex;
  align-items: center;
  margin: 0 8px 4px;
}

.tracking-people__group-toggle {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  border: 0;
  color: #344056;
  background: transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.tracking-people__group-toggle:focus-visible {
  outline: 2px solid #4d91ff;
  outline-offset: 2px;
}

.tracking-people__chevron {
  color: #8995aa;
  transition: transform .2s ease;
}

[data-collapsed="true"] .tracking-people__chevron {
  transform: rotate(180deg);
}

.tracking-people__person {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  color: #32405d;
  background: transparent;
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.tracking-people__person:hover {
  background: #f2f7fc;
}

.tracking-people__person.is-active,
.tracking-people__person.is-selected {
  color: #2f77dc;
  background: #dceeff;
}

.tracking-people__person:focus-visible {
  outline: 2px solid #4d91ff;
  outline-offset: 1px;
}

.tracking-people__avatar {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 7px;
  color: #fff;
  background: #1fb4c2;
  font-size: 12px;
}

.tracking-people__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tracking-people__empty {
  margin: 18px 8px;
  color: #8b95a9;
  font-size: 13px;
  text-align: center;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 768px) {
  .tracking-people {
    height: auto;
    padding: 10px;
    overflow: visible;
  }

  .tracking-people__groups {
    min-width: 0;
  }

  .goal-people-list {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
  }

  .goal-person-item {
    width: 190px;
    min-width: 190px;
  }
}
</style>

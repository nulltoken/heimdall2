<template>
  <Base :show-search="false" title="Heimdall - Groups">
    <template #main-content>
      <v-tabs v-model="activeTab" fixed-tabs dark>
        <v-tab key="my-groups"> My Groups </v-tab>
        <v-tab key="public-groups"> All Groups </v-tab>
      </v-tabs>
      <v-container>
        <v-row>
          <v-col>
            <v-card>
              <v-tabs-items v-model="activeTab">
                <v-tab-item key="my-groups">
                  <GroupManagement :all-groups="false" />
                </v-tab-item>
                <v-tab-item key="all-groups">
                  <GroupManagement :all-groups="true" />
                </v-tab-item>
              </v-tabs-items>
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </template>
  </Base>
</template>

<script lang="ts">
import GroupManagement from '@/components/global/groups/GroupManagement.vue';
import Base from '@/views/Base.vue';
import Vue from 'vue';
import {Component} from 'vue-property-decorator';

@Component({
  components: {
    Base,
    GroupManagement
  }
})
export default class Groups extends Vue {
  activeTab = 'my-groups';
}
</script>

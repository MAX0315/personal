const { motion } = Motion;

const tvcWorks = [
  {
    "title": "3D跑鞋_横1920",
    "file": "tvc-001.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  },
  {
    "title": "耳机1_横1920",
    "file": "tvc-002.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  },
  {
    "title": "耳机2_横1920",
    "file": "tvc-003.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  },
  {
    "title": "机器人C1_横1920",
    "file": "tvc-004.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  },
  {
    "title": "机器人C2_横1920",
    "file": "tvc-005.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  },
  {
    "title": "假发_横1920",
    "file": "tvc-006.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  },
  {
    "title": "礼服",
    "file": "tvc-007.mp4",
    "orientation": "portrait",
    "source": "tvc",
    "category": "TVC案例_竖"
  },
  {
    "title": "跑鞋",
    "file": "tvc-008.mp4",
    "orientation": "portrait",
    "source": "tvc",
    "category": "TVC案例_竖"
  },
  {
    "title": "人体工学椅_横1920",
    "file": "tvc-009.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  },
  {
    "title": "推进器_横1920",
    "file": "tvc-010.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  },
  {
    "title": "置物架_横1920",
    "file": "tvc-011.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  },
  {
    "title": "Carplay_横1920",
    "file": "tvc-012.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  },
  {
    "title": "Jackery_横1920",
    "file": "tvc-013.mp4",
    "orientation": "landscape",
    "source": "tvc",
    "category": "TVC案例_横"
  }
];

const adWorks = [
  {
    "title": "Jackery_横3840_草地",
    "file": "ads-001.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Jackery_横3840_城市",
    "file": "ads-002.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "割草机_竖1200_1",
    "file": "ads-003.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_竖"
  },
  {
    "title": "割草机_竖1200_2",
    "file": "ads-004.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_竖"
  },
  {
    "title": "割草机_竖1200_3",
    "file": "ads-005.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_竖"
  },
  {
    "title": "荣耀_横1200_耳机1",
    "file": "ads-006.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "荣耀_横1200_耳机2",
    "file": "ads-007.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "荣耀_横1920_手机1",
    "file": "ads-008.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "荣耀_横1920_手机2",
    "file": "ads-009.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "荣耀_横1920_手机3",
    "file": "ads-010.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "荣耀_横1920_手机4",
    "file": "ads-011.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "荣耀_横1920_手机5",
    "file": "ads-012.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "荣耀_横1920_手机6",
    "file": "ads-013.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "荣耀_横1920_手机7",
    "file": "ads-014.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "荣耀_横1920_手机8",
    "file": "ads-015.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "荣耀_竖1920_1",
    "file": "ads-016.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_竖"
  },
  {
    "title": "荣耀_竖1920_2",
    "file": "ads-017.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_竖"
  },
  {
    "title": "松灵_横1200_1",
    "file": "ads-018.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Anker_方1080_1",
    "file": "ads-019.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_竖"
  },
  {
    "title": "Anker_横1920_1",
    "file": "ads-020.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Anker_横1920_2",
    "file": "ads-021.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Anker_横1920_3",
    "file": "ads-022.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_横1920_手机1",
    "file": "ads-023.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_横1920_手机2",
    "file": "ads-024.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_横1920_手机3",
    "file": "ads-025.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_横1920_手机4",
    "file": "ads-026.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_横1920_手机4",
    "file": "ads-027.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_横1920_手机5",
    "file": "ads-028.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_横1920_手机5",
    "file": "ads-029.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_横1920_手机6",
    "file": "ads-030.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_横2560_1",
    "file": "ads-031.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_横2560_2",
    "file": "ads-032.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Honor_竖1920_圣诞活动",
    "file": "ads-033.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_竖"
  },
  {
    "title": "Jackery_横1920_1",
    "file": "ads-034.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Jackery_横1920_2",
    "file": "ads-035.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Mova_方1080_1",
    "file": "ads-036.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_竖"
  },
  {
    "title": "Sunhome_横_1",
    "file": "ads-037.mp4",
    "orientation": "landscape",
    "source": "ads",
    "category": "投放案例_横"
  },
  {
    "title": "Sunhome_竖1920圣诞",
    "file": "ads-038.mp4",
    "orientation": "portrait",
    "source": "ads",
    "category": "投放案例_竖"
  }
];

const feedWorks = [
  {
    "title": "竖1280_熬夜",
    "file": "feed-p-001.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_高跟鞋",
    "file": "feed-p-002.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_鸡蛋收纳",
    "file": "feed-p-003.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_鸡尾酒",
    "file": "feed-p-004.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_鸡尾酒2",
    "file": "feed-p-005.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_积木",
    "file": "feed-p-006.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_搅拌杯",
    "file": "feed-p-007.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_搅拌杯2",
    "file": "feed-p-008.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_礼物",
    "file": "feed-p-009.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_沙拉杯",
    "file": "feed-p-010.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_收纳瓶",
    "file": "feed-p-011.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_水龙头",
    "file": "feed-p-012.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_甜玉米",
    "file": "feed-p-013.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_童装",
    "file": "feed-p-014.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_土豆",
    "file": "feed-p-015.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_推门",
    "file": "feed-p-016.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_卫裤",
    "file": "feed-p-017.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_药盒",
    "file": "feed-p-018.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "竖1280_自拍杆",
    "file": "feed-p-019.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_竖"
  },
  {
    "title": "横2160_Sheet",
    "file": "feed-l-001.mp4",
    "orientation": "portrait",
    "source": "feed",
    "category": "信息流剪辑_横"
  }
];

const designWorks = [
  {
    "title": "横1600_旅游1",
    "file": "op-h-001.png",
    "category": "运营海报_横",
    "orientation": "landscape"
  },
  {
    "title": "横1600_旅游2",
    "file": "op-h-002.png",
    "category": "运营海报_横",
    "orientation": "landscape"
  },
  {
    "title": "横1600_旅游3",
    "file": "op-h-003.png",
    "category": "运营海报_横",
    "orientation": "landscape"
  },
  {
    "title": "横1600_旅游4",
    "file": "op-h-004.png",
    "category": "运营海报_横",
    "orientation": "landscape"
  },
  {
    "title": "康愈_竖1200_1",
    "file": "op-v-001.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "康愈_竖1920_1",
    "file": "op-v-002.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "昆曲博物馆_竖1920_1",
    "file": "op-v-003.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "昆曲博物馆_竖1920_2",
    "file": "op-v-004.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_地标1",
    "file": "op-v-005.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_地标2",
    "file": "op-v-006.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_地标3",
    "file": "op-v-007.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_地标4",
    "file": "op-v-008.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_国学文字1",
    "file": "op-v-009.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_国学文字2",
    "file": "op-v-010.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_国学文字3",
    "file": "op-v-011.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_国学文字4",
    "file": "op-v-012.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_季节1",
    "file": "op-v-013.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_季节2",
    "file": "op-v-014.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_季节3",
    "file": "op-v-015.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_季节4",
    "file": "op-v-016.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气1",
    "file": "op-v-017.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气2",
    "file": "op-v-018.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气3",
    "file": "op-v-019.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气4",
    "file": "op-v-020.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气5",
    "file": "op-v-021.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气6",
    "file": "op-v-022.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气7",
    "file": "op-v-023.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气8",
    "file": "op-v-024.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气9",
    "file": "op-v-025.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气10",
    "file": "op-v-026.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气11",
    "file": "op-v-027.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_节气12",
    "file": "op-v-028.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_美食1",
    "file": "op-v-029.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_美食2",
    "file": "op-v-030.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_美食3",
    "file": "op-v-031.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_美食4",
    "file": "op-v-032.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_名著1",
    "file": "op-v-033.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_名著2",
    "file": "op-v-034.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_名著3",
    "file": "op-v-035.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_名著4",
    "file": "op-v-036.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_为乐而连1",
    "file": "op-v-037.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_为乐而连2",
    "file": "op-v-038.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_为乐而连3",
    "file": "op-v-039.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_饮品1",
    "file": "op-v-040.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_饮品2",
    "file": "op-v-041.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_饮品3",
    "file": "op-v-042.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_饮品4",
    "file": "op-v-043.png",
    "category": "运营海报_竖",
    "orientation": "portrait"
  }
];

const operation25Works = [
  {
    "title": "竖1920_1",
    "file": "op25-001.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_2",
    "file": "op25-002.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_3",
    "file": "op25-003.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_4",
    "file": "op25-004.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_5",
    "file": "op25-005.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_6",
    "file": "op25-006.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_7",
    "file": "op25-007.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_8",
    "file": "op25-008.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_9",
    "file": "op25-009.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_10",
    "file": "op25-010.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_11",
    "file": "op25-011.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_12",
    "file": "op25-012.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_13",
    "file": "op25-013.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_14",
    "file": "op25-014.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_15",
    "file": "op25-015.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_16",
    "file": "op25-016.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_17",
    "file": "op25-017.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_18",
    "file": "op25-018.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_19",
    "file": "op25-019.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_20",
    "file": "op25-020.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_21",
    "file": "op25-021.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_22",
    "file": "op25-022.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_23",
    "file": "op25-023.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_24",
    "file": "op25-024.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_25",
    "file": "op25-025.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_26",
    "file": "op25-026.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_27",
    "file": "op25-027.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_28",
    "file": "op25-028.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_29",
    "file": "op25-029.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_30",
    "file": "op25-030.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_31",
    "file": "op25-031.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_32",
    "file": "op25-032.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_33",
    "file": "op25-033.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_34",
    "file": "op25-034.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_35",
    "file": "op25-035.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_36",
    "file": "op25-036.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_37",
    "file": "op25-037.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_38",
    "file": "op25-038.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_39",
    "file": "op25-039.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_40",
    "file": "op25-040.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_41",
    "file": "op25-041.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_42",
    "file": "op25-042.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_43",
    "file": "op25-043.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_44",
    "file": "op25-044.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_45",
    "file": "op25-045.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_46",
    "file": "op25-046.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_47",
    "file": "op25-047.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_48",
    "file": "op25-048.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_49",
    "file": "op25-049.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_50",
    "file": "op25-050.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_51",
    "file": "op25-051.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_52",
    "file": "op25-052.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_53",
    "file": "op25-053.png",
    "folder": "operation-25",
    "orientation": "portrait"
  },
  {
    "title": "竖1920_54",
    "file": "op25-054.png",
    "folder": "operation-25",
    "orientation": "portrait"
  }
];

const ipWorks = [
  {
    "title": "横1200_场景图1",
    "file": "ip-001.png",
    "folder": "ip-series"
  },
  {
    "title": "横1200_场景图2",
    "file": "ip-002.png",
    "folder": "ip-series"
  },
  {
    "title": "横1200_场景图3",
    "file": "ip-003.png",
    "folder": "ip-series"
  },
  {
    "title": "横1200_场景图4",
    "file": "ip-004.png",
    "folder": "ip-series"
  },
  {
    "title": "横1200_场景图5",
    "file": "ip-005.png",
    "folder": "ip-series"
  },
  {
    "title": "横1200_场景图6",
    "file": "ip-006.png",
    "folder": "ip-series"
  },
  {
    "title": "横1200_角色延展1",
    "file": "ip-007.png",
    "folder": "ip-series"
  },
  {
    "title": "横1200_角色延展2",
    "file": "ip-008.png",
    "folder": "ip-series"
  },
  {
    "title": "横1920_大场景1",
    "file": "ip-009.png",
    "folder": "ip-series"
  },
  {
    "title": "横1920_大场景2",
    "file": "ip-010.png",
    "folder": "ip-series"
  },
  {
    "title": "横1920_大场景3",
    "file": "ip-011.png",
    "folder": "ip-series"
  },
  {
    "title": "横1920_大场景4",
    "file": "ip-012.png",
    "folder": "ip-series"
  },
  {
    "title": "横1920_大场景5",
    "file": "ip-013.png",
    "folder": "ip-series"
  },
  {
    "title": "横1920_大场景6",
    "file": "ip-014.png",
    "folder": "ip-series"
  },
  {
    "title": "横1920_IP主形象1",
    "file": "ip-015.png",
    "folder": "ip-series"
  },
  {
    "title": "横1920_IP主形象2",
    "file": "ip-016.png",
    "folder": "ip-series"
  }
];

const commercialWorks = [
  {
    "title": "横1080_Anker1",
    "file": "commercial-h-001.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Anker2",
    "file": "commercial-h-002.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Anker3",
    "file": "commercial-h-003.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Anker4",
    "file": "commercial-h-004.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Anker5",
    "file": "commercial-h-005.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Jackery1",
    "file": "commercial-h-006.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Jackery2",
    "file": "commercial-h-007.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Jackery3",
    "file": "commercial-h-008.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Jackery4",
    "file": "commercial-h-009.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Jackery5",
    "file": "commercial-h-010.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Jackery6",
    "file": "commercial-h-011.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_割草机1",
    "file": "commercial-h-012.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_割草机2",
    "file": "commercial-h-013.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_割草机3",
    "file": "commercial-h-014.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人1",
    "file": "commercial-h-015.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人2",
    "file": "commercial-h-016.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人3",
    "file": "commercial-h-017.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人4",
    "file": "commercial-h-018.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人5",
    "file": "commercial-h-019.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人6",
    "file": "commercial-h-020.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人7",
    "file": "commercial-h-021.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人8",
    "file": "commercial-h-022.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人9",
    "file": "commercial-h-023.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人10",
    "file": "commercial-h-024.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人11",
    "file": "commercial-h-025.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人12",
    "file": "commercial-h-026.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人13",
    "file": "commercial-h-027.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_机器人14",
    "file": "commercial-h-028.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_荣耀1",
    "file": "commercial-h-029.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_游戏1",
    "file": "commercial-h-030.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_游戏2",
    "file": "commercial-h-031.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_游戏3",
    "file": "commercial-h-032.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_游戏4",
    "file": "commercial-h-033.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_游戏5",
    "file": "commercial-h-034.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_游戏6",
    "file": "commercial-h-035.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅1",
    "file": "commercial-h-036.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅2",
    "file": "commercial-h-037.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅3",
    "file": "commercial-h-038.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅4",
    "file": "commercial-h-039.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅5",
    "file": "commercial-h-040.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅6",
    "file": "commercial-h-041.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅7",
    "file": "commercial-h-042.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅8",
    "file": "commercial-h-043.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅9",
    "file": "commercial-h-044.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅10",
    "file": "commercial-h-045.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅11",
    "file": "commercial-h-046.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅吸尘器1",
    "file": "commercial-h-047.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅吸尘器2",
    "file": "commercial-h-048.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅吸尘器3",
    "file": "commercial-h-049.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅吸尘器4",
    "file": "commercial-h-050.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅吸尘器5",
    "file": "commercial-h-051.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅吸尘器6",
    "file": "commercial-h-052.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅吸尘器7",
    "file": "commercial-h-053.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅吸尘器8",
    "file": "commercial-h-054.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅吸尘器9",
    "file": "commercial-h-055.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1200_追觅吸尘器10",
    "file": "commercial-h-056.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Anker1",
    "file": "commercial-h-057.png",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame1",
    "file": "commercial-h-058.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame2",
    "file": "commercial-h-059.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame3",
    "file": "commercial-h-060.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame4",
    "file": "commercial-h-061.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame5",
    "file": "commercial-h-062.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame6",
    "file": "commercial-h-063.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame7",
    "file": "commercial-h-064.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame8",
    "file": "commercial-h-065.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame9",
    "file": "commercial-h-066.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame10",
    "file": "commercial-h-067.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame11",
    "file": "commercial-h-068.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame12",
    "file": "commercial-h-069.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame13",
    "file": "commercial-h-070.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame14",
    "file": "commercial-h-071.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame15",
    "file": "commercial-h-072.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame16",
    "file": "commercial-h-073.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame17",
    "file": "commercial-h-074.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame18",
    "file": "commercial-h-075.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame19",
    "file": "commercial-h-076.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame20",
    "file": "commercial-h-077.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame21",
    "file": "commercial-h-078.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame22",
    "file": "commercial-h-079.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame23",
    "file": "commercial-h-080.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame24",
    "file": "commercial-h-081.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame25",
    "file": "commercial-h-082.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame26",
    "file": "commercial-h-083.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame27",
    "file": "commercial-h-084.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame28",
    "file": "commercial-h-085.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame31",
    "file": "commercial-h-086.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame32",
    "file": "commercial-h-087.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame33",
    "file": "commercial-h-088.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame34",
    "file": "commercial-h-089.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame35",
    "file": "commercial-h-090.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame36",
    "file": "commercial-h-091.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame37",
    "file": "commercial-h-092.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame38",
    "file": "commercial-h-093.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame39",
    "file": "commercial-h-094.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame40",
    "file": "commercial-h-095.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame41",
    "file": "commercial-h-096.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame42",
    "file": "commercial-h-097.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame43",
    "file": "commercial-h-098.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame44",
    "file": "commercial-h-099.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame45",
    "file": "commercial-h-100.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame46",
    "file": "commercial-h-101.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame47",
    "file": "commercial-h-102.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame48",
    "file": "commercial-h-103.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame49",
    "file": "commercial-h-104.gif",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame50",
    "file": "commercial-h-105.gif",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame51",
    "file": "commercial-h-106.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame52",
    "file": "commercial-h-107.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame53",
    "file": "commercial-h-108.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame54",
    "file": "commercial-h-109.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame55",
    "file": "commercial-h-110.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame56",
    "file": "commercial-h-111.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame57",
    "file": "commercial-h-112.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame58",
    "file": "commercial-h-113.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame59",
    "file": "commercial-h-114.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame60",
    "file": "commercial-h-115.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame61",
    "file": "commercial-h-116.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1920_Dreame62",
    "file": "commercial-h-117.jpg",
    "folder": "commercial-posters",
    "orientation": "landscape"
  },
  {
    "title": "横1080_Jackery1",
    "file": "commercial-v-001.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "横1080_Jackery2",
    "file": "commercial-v-002.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "横1080_Jackery3",
    "file": "commercial-v-003.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "横1080_Jackery4",
    "file": "commercial-v-004.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "横1080_Jackery5",
    "file": "commercial-v-005.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "横1080_Jackery6",
    "file": "commercial-v-006.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "竖1200_美的1",
    "file": "commercial-v-007.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "竖1200_美的2",
    "file": "commercial-v-008.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "竖1200_荣耀1",
    "file": "commercial-v-009.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "竖1200_荣耀2",
    "file": "commercial-v-010.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "竖1200_荣耀3",
    "file": "commercial-v-011.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  },
  {
    "title": "Jacery海报2-1080×1080(1)",
    "file": "commercial-v-012.png",
    "folder": "commercial-posters",
    "orientation": "portrait"
  }
];

const fadeUp = {
  hidden: { opacity: 0, y: 22, filter: "blur(10px)" },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { delay, duration: 0.65, ease: "easeOut" },
  }),
};

function applyVideoRatio(event) {
  const video = event.currentTarget;
  if (!video.videoWidth || !video.videoHeight) return;
  const ratio = `${video.videoWidth} / ${video.videoHeight}`;
  const frame = video.closest(".video-frame");
  const card = video.closest(".work-card");
  const width = video.videoWidth;
  const height = video.videoHeight;
  const shape = Math.abs(width - height) <= Math.max(width, height) * 0.06
    ? "square"
    : width > height
      ? "landscape"
      : "portrait";
  const maxFrameWidth = shape === "landscape" ? "" : `${Math.round(Math.min(420, 420 * width / height))}px`;

  video.style.aspectRatio = ratio;
  if (card) {
    card.dataset.videoShape = shape;
    card.style.setProperty("--natural-frame-width", maxFrameWidth);
  }
  if (frame) {
    frame.style.setProperty("aspect-ratio", ratio);
    frame.style.setProperty("--natural-frame-width", maxFrameWidth);
  }
}

function ArrowUpRight({ className = "h-5 w-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17L17 7M7 7h10v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h7A2.5 2.5 0 0 1 16 7.5v9A2.5 2.5 0 0 1 13.5 19h-7A2.5 2.5 0 0 1 4 16.5v-9Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 10 4-2.2v8.4L16 14v-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function FeedIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="m11 9 5 3-5 3V9Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 2v3M16 2v3M8 19v3M16 19v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DesignIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 4h14v11H5V4Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 20h8M10 15l-1 5M14 15l1 5M8 8h8M8 11h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h16v12H4V6Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="m5 7 7 6 7-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 9h10v10H9V9Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 15H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h9a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function CapIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m3 9 9-4 9 4-9 4-9-4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M7 11.2V16c2.8 2 7.2 2 10 0v-4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function FlameLineIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21c4 0 7-2.8 7-6.7 0-3.4-2.4-6-5.5-9.3-.3 2.5-1.2 4.1-2.7 5.2-.2-1.7-1-3.1-2.1-4.2C7.8 9 5 11.6 5 14.5 5 18.3 8 21 12 21Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function CopyButton({ value, label }) {
  return (
    <button className="copy-icon-button" type="button" title={`复制${label}`} aria-label={`复制${label}`} onClick={() => navigator.clipboard?.writeText(value)}>
      <CopyIcon />
    </button>
  );
}

function WechatIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10.2 17.2c-3.6 0-6.7-2.4-6.7-5.5s3-5.5 6.7-5.5c3 0 5.6 1.7 6.4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M13.8 11.2c3.6 0 6.7 2.2 6.7 5 0 1.4-.7 2.7-1.9 3.6l.5 2-2.3-1.1c-.9.3-1.9.5-3 .5-3.6 0-6.7-2.2-6.7-5s3-5 6.7-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 10h.01M12 10h.01M12 16h.01M16 16h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function ContactHover({ className = "", open = false, onEnter, onLeave }) {
  return (
    <div className={`contact-popover${className ? ` ${className}` : ""}${open ? " is-open" : ""}`} onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter} onBlur={onLeave}>
      <button className="liquid-glass contact-trigger" type="button">联系</button>
      <div className="contact-menu liquid-glass" aria-label="Contact information">
        <div className="contact-line"><WechatIcon /> <span>WX: Mx2215457940</span><CopyButton value="Mx2215457940" label="WX" /></div>
        <div className="contact-line"><MailIcon /> <a href="mailto:mx22154@163.com">mx22154@163.com</a><CopyButton value="mx22154@163.com" label="邮箱" /></div>
      </div>
    </div>
  );
}

function HomeUtilityRow() {
  const [active, setActive] = React.useState("");
  const closeTimer = React.useRef(null);

  const show = (name) => {
    window.clearTimeout(closeTimer.current);
    setActive(name);
  };

  const hideSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setActive(""), 1000);
  };

  return (
    <motion.div className="home-utility-row" variants={fadeUp} initial="hidden" animate="visible" custom={0.48}>
      <div className={`about-popover${active === "about" ? " is-open" : ""}`} onMouseEnter={() => show("about")} onMouseLeave={hideSoon} onFocus={() => show("about")} onBlur={hideSoon}>
        <button className="liquid-glass contact-trigger" type="button">关于我</button>
        <div className="about-menu liquid-glass" aria-label="About ANMA">
          <div><SparkIcon /> <span>人民日报 AI 创作者｜TapNow超级讲师</span></div>
          <div><CapIcon /> <span>工信部认证讲师｜福建省人工智能专家</span></div>
          <div><FlameLineIcon /> <span>站酷超级 AI 设计师｜站酷人气 150w+</span></div>
        </div>
      </div>
      <ContactHover className="home-contact" open={active === "contact"} onEnter={() => show("contact")} onLeave={hideSoon} />
    </motion.div>
  );
}

function Header({ compact = false, currentPage = "" }) {
  return (
    <header className={`site-header${compact ? " secondary-header" : ""}`}>
      {compact ? (
        <>
          <a className="brand-pill liquid-glass secondary-tab" href="index.html" aria-label="ANMA PROTFOILO home">首页</a>
          <nav className="secondary-nav" aria-label="Secondary navigation">
            <a className={`liquid-glass small-link${currentPage === "video" ? " is-active" : ""}`} href="video.html">AI视频作品</a>
            <a className={`liquid-glass small-link${currentPage === "design" ? " is-active" : ""}`} href="design.html">AI设计作品</a>
            <a className={`liquid-glass small-link${currentPage === "feed" ? " is-active" : ""}`} href="feed.html">信息流视频</a>
            <a className="liquid-glass small-link" href="https://zhanku.zcool.com.cn/" target="_blank" rel="noreferrer">个人主页展示</a>
          </nav>
        </>
      ) : (
        <>
          <a className="brand-pill liquid-glass" href="index.html" aria-label="ANMA PROTFOILO home">ANMA</a>
          <ContactHover />
        </>
      )}
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
        苏ICP备2026047442号
      </a>
    </footer>
  );
}

function Home() {
  return (
    <main className="home-shell">
      <video
        className="ambient-video"
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260418_080021_d598092b-c4c2-4e53-8e46-94cf9064cd50.mp4"
        autoPlay
        muted
        playsInline
        loop
        preload="auto"
        aria-hidden="true"
      />
      <div className="noise-layer" aria-hidden="true" />

      <section className="home-hero" aria-label="ANMA portfolio">
        <motion.h1 variants={fadeUp} initial="hidden" animate="visible" custom={0.2}>ANMA PROTFOILO</motion.h1>
        <motion.div className="action-grid" variants={fadeUp} initial="hidden" animate="visible" custom={0.35}>
          <MainButton href="video.html" icon={<VideoIcon />} title="AI视频作品" note="TVC / Product Motion" />
          <MainButton href="design.html" icon={<DesignIcon />} title="AI设计作品" note="Visual / Concept Design" />
          <MainButton href="feed.html" icon={<FeedIcon />} title="信息流视频" note="Short-form Edits" />
          <MainButton href="https://zhanku.zcool.com.cn/" icon={<UserIcon />} title="个人主页展示" note="ZCOOL Profile" external />
        </motion.div>
        <HomeUtilityRow />
      </section>
      <SiteFooter />
    </main>
  );
}

function MainButton({ href, icon, title, note, external = false }) {
  return (
    <a className="main-button liquid-glass-strong" href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
      <span className="button-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <em>{note}</em>
      </span>
      <ArrowUpRight />
    </a>
  );
}

function VideoWorks() {
  const sections = [
    { title: "TVC案例_横", works: tvcWorks.filter((work) => work.category === "TVC案例_横"), variant: "landscape" },
    { title: "TVC案例_竖", works: tvcWorks.filter((work) => work.category === "TVC案例_竖"), variant: "portrait" },
    { title: "投放案例_横", works: adWorks.filter((work) => work.category === "投放案例_横"), variant: "landscape" },
    { title: "投放案例_竖", works: adWorks.filter((work) => work.category === "投放案例_竖"), variant: "portrait" },
  ];

  return (
    <main className="works-page video-page">
      <Header compact currentPage="video" />
      <section className="works-hero">
        <h1>AI视频作品</h1>
      </section>
      <section className="video-section">
        {sections.map((section) => (
          <VideoSection section={section} key={section.title} />
        ))}
      </section>
      <SiteFooter />
    </main>
  );
}

function VideoSection({ section }) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div className={`case-section ${section.variant}-section${collapsed ? " is-collapsed" : ""}`}>
      <div className="section-heading">
        <div className="section-label">{section.title}</div>
        <button className="section-toggle" type="button" aria-label={collapsed ? `展开${section.title}` : `收起${section.title}`} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        </button>
      </div>
      {!collapsed && (
        <div className={`video-grid ${section.variant === "landscape" ? "landscape-grid" : "portrait-grid"}`}>
          {section.works.map((work) => <VideoCard work={work} key={`${work.source}-${work.file}`} />)}
        </div>
      )}
    </div>
  );
}

function VideoCard({ work }) {
  const src = `assets/videos/${work.source}/${work.file}`;

  return (
    <article className={`work-card liquid-glass ${work.orientation}`} key={work.file}>
      <div className="video-frame">
        <video
          src={src}
          controls
          preload="metadata"
          playsInline
          webkit-playsinline="true"
          onLoadedMetadata={applyVideoRatio}
        />
      </div>
      <div className="work-meta">
        <strong>{work.title}</strong>
        <a href={src} target="_blank" rel="noreferrer">打开视频 <ArrowUpRight className="h-4 w-4" /></a>
      </div>
    </article>
  );
}

function FeedWorks() {
  const sections = [
    { title: "信息流剪辑_竖", works: feedWorks.filter((work) => work.category === "信息流剪辑_竖"), variant: "portrait" },
    { title: "信息流剪辑_横", works: feedWorks.filter((work) => work.category === "信息流剪辑_横"), variant: "landscape" },
  ];

  return (
    <main className="works-page feed-page video-page">
      <Header compact currentPage="feed" />
      <section className="works-hero">
        <h1>信息流视频</h1>
      </section>
      <section className="video-section">
        {sections.map((section) => (
          <VideoSection section={section} key={section.title} />
        ))}
      </section>
      <SiteFooter />
    </main>
  );
}

function DesignWorks() {
  const sections = [
    { title: "AI商业海报", works: commercialWorks, variant: "masonry" },
    { title: "运营海报_横", works: designWorks.filter((work) => work.category === "运营海报_横"), variant: "landscape" },
    { title: "运营海报_竖", works: designWorks.filter((work) => work.category === "运营海报_竖"), variant: "portrait" },
    { title: "25运营", works: operation25Works, variant: "portrait" },
    { title: "IP系列", works: ipWorks, variant: "landscape" },
  ];

  return (
    <main className="works-page design-page">
      <Header compact currentPage="design" />
      <section className="works-hero">
        <h1>AI设计作品</h1>
      </section>
      <section className="video-section">
        {sections.map((section) => (
          <DesignSection section={section} key={section.title} />
        ))}
      </section>
      <SiteFooter />
    </main>
  );
}

function DesignSection({ section }) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div className={`case-section ${section.variant}-section${collapsed ? " is-collapsed" : ""}`}>
      <div className="section-heading">
        <div className="section-label">{section.title}</div>
        <button className="section-toggle" type="button" aria-label={collapsed ? `展开${section.title}` : `收起${section.title}`} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        </button>
      </div>
      {!collapsed && (section.works.length ? (
        <div className="design-masonry">
          {section.works.map((work) => <DesignCard work={work} key={work.file} />)}
        </div>
      ) : (
        <div className="empty-section liquid-glass">该分类暂无作品</div>
      ))}
    </div>
  );
}

function DesignCard({ work }) {
  const folder = work.folder || "operation-posters";
  const src = `assets/design/${folder}/${work.file}`;

  return (
    <article className={`work-card design-work-card liquid-glass ${work.orientation}`} key={work.file}>
      <a className="image-frame" href={src} target="_blank" rel="noreferrer" aria-label={`打开${work.title}`}>
        <img src={src} alt={work.title} loading="lazy" />
      </a>
      <div className="work-meta">
        <strong>{work.title}</strong>
        <a href={src} target="_blank" rel="noreferrer">查看 <ArrowUpRight className="h-4 w-4" /></a>
      </div>
    </article>
  );
}

function App() {
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith("/video.html")) return <VideoWorks />;
  if (path.endsWith("/feed.html")) return <FeedWorks />;
  if (path.endsWith("/design.html")) return <DesignWorks />;
  return <Home />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

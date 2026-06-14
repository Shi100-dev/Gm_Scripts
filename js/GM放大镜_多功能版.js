// ==UserScript==
// @name         GM-勋章放大镜
// @namespace    https://docs.scriptcat.org/
// @version      2.2.4
// @description  暗黑模式的勋章放大镜
// @author       1:轶致2:咸鱼鱼3:哈哈哈哈_
// @match        *://*.gamemale.com/*
// @match        *://badge.saltfish.cc.cd/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gamemale.com
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// ==/UserScript==

function pLimit(concurrency) {
    const queue = [];
    let activeCount = 0;

    const next = () => {
        activeCount--;

        if (queue.length > 0) {
            queue.shift()();
        }
    };

    const run = async (fn, resolve, args) => {
        activeCount++;

        const result = Promise.resolve(fn(...args));

        resolve(result);

        try {
            await result;
        } finally {
            next();
        }
    };

    const enqueue = (fn, resolve, args) => {
        queue.push(run.bind(null, fn, resolve, args));

        queueMicrotask(() => {
            if (activeCount < concurrency && queue.length > 0) {
                queue.shift()();
            }
        });
    };

    return (fn, ...args) =>
        new Promise(resolve => {
            enqueue(fn, resolve, args);
        });
}

(function () {
    'use strict';

    /**
     * 勋章博物馆数据（非博物馆数据记录到后面的 medalDataNoTid 中）
     * ---
     * **MedalItem字段详细说明：**
     * - `@property {string} type` ── 类型
     * - `@property {string} no` ── 编号
     * - `@property {string} url_tid` ── 勋章博物馆帖子tid
     * - `@property {string} name` ── 勋章类型
     * - `@property {string} date` ── 勋章博物馆发帖日期
     * - `@property {string} buy_limit` ── 购买勋章的限制。无限制的时候填写 无；比较符号统一使用 ≥ ≤ > < = 单个符号。
     * - `@property {string} price` ── 商店售价
     * - `@property {string} [backstory]` ── 背景故事（可选，该字段可不存在）
     * - `@property {string} [duration]` ── 持续时长（可选，该字段可不存在）
     * - `@property {string} levels` ── 各等级的收益信息。等级间\n分隔；比较符号统一使用 ≥ ≤ > < = 单个符号。
     * - `@property {Object} levels_img` ── 各等级对应的图片信息
     *   - `["初级"]` ── 【等级 初级】的图片配置 `[url, size]`（可选）
     *   - `["1"]` ── 【等级 1】的图片配置 `[url, size]`
     *   - `[Max]` ── 【Max】最高等级的图片配置 `[url, size]`
     * ---
     * @type  {any[]}
     */

    /* 插入位置 */

    // Object.hasOwn 兼容性处理
    if (!Object.hasOwn) {
        Object.defineProperty(Object, 'hasOwn', {
            value: function (object, property) {
                if (object == null) {
                    throw new TypeError('Cannot convert undefined or null to object');
                }
                return Object.prototype.hasOwnProperty.call(Object(object), property);
            },
            configurable: true,
            enumerable: false,
            writable: true,
        });
    }
    // CSP 策略
    (() => {
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
            if (!window.trustedTypes.defaultPolicy) {
                window.trustedTypes.createPolicy('default', {
                    createHTML: (html) => html
                });
            }
        }
    })();

    /* ------------------------------------------------------ */

    /**
     * Idb数据库工具
     */
    class IdbStorageManager {
        constructor(config = {}) {
            this.dbName = config.dbName;
            this.version = config.version || 1;
            // 允许传入多个表的配置
            this.storesConfig = config.stores || [];
            this.db = null;
        }

        /**
         * 内部工具：打开数据库并处理多表创建
         */
        #open = async (targetVersion) => {
            if (this.db) return this.db; // 单例模式，避免重复打开

            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, targetVersion);

                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    // 遍历配置，创建多个表
                    this.storesConfig.forEach(cfg => {
                        if (!db.objectStoreNames.contains(cfg.name)) {
                            const store = db.createObjectStore(cfg.name, cfg.options || { keyPath: 'id', autoIncrement: true });

                            // 如果有索引配置则创建索引
                            if (cfg.indexes) {
                                cfg.indexes.forEach(idx => {
                                    store.createIndex(idx.name, idx.keyPath, idx.options || { unique: false });
                                });
                            }
                        }
                    });
                };

                request.onsuccess = () => {
                    this.db = request.result;
                    this.db.onversionchange = () => {
                        this.db.close();
                        this.db = null;
                        console.log("[Idb] 发现新版本，已关闭旧连接");
                    };
                    resolve(this.db);
                };
                request.onblocked = () => {
                    console.error("[Idb] 升级被阻塞，请检查是否有其他脚本未关闭连接");
                };
                request.onerror = () => reject(request.error);
            });
        };
        /**
         * 内部异步执行器：处理数据库打开、表检查、事务创建及逻辑注入
         * @param {string} storeName 表名
         * @param {string} mode 事务模式 'readonly' | 'readwrite'
         * @param {function} callback 具体的业务逻辑，接收 (store, transaction)
         */
        async #execute(storeName, mode, callback) {
            let db = await this.#open(); // 确保数据库已打开

            // 1. 硬检查：物理表是否存在
            if (!db.objectStoreNames.contains(storeName)) {
                const currentVersion = db.version;
                const err = `[IdbError] 表 "${storeName}" 在物理数据库中不存在。可能原因：1.拼写错误 2.新增表后未升级版本号(当前版本:${currentVersion})\n尝试升级版本`;
                console.error(err);

                db.close();
                this.db = null;
                this.version = currentVersion + 1;
                db = await this.#open(this.version);
                if (!db.objectStoreNames.contains(storeName)) {
                    throw new Error("异常，表配置缺失");
                }
            }

            return new Promise((resolve, reject) => {
                try {
                    const tx = db.transaction(storeName, mode);
                    const store = tx.objectStore(storeName);

                    // 执行注入的逻辑
                    // callback 可以是 async，也可以返回一个 IDBRequest
                    const result = callback(store, tx);

                    // 如果返回的是 IDBRequest (如 store.add())
                    if (result instanceof IDBRequest) {
                        result.onsuccess = () => resolve(result.result);
                        result.onerror = () => reject(result.error);
                    } else if (result instanceof Promise) {
                        // 如果返回的是 Promise (自定义复杂逻辑)
                        result.then(resolve).catch(reject);
                    } else {
                        // 如果是同步返回结果
                        resolve(result);
                    }

                    tx.onerror = () => reject(tx.error);
                    store.onerror = () => reject(store.error);
                } catch (err) {
                    reject(err);
                }
            });
        }
        /**
         * 核心方法：指定操作的表
         * @param {string} storeName 表名
         */
        model(storeName) {
            // 返回一个包含操作方法的代理对象
            return {
                /**
                 * 添加数据
                 */
                add: (record) => this.#execute(storeName, 'readwrite', s => s.add(record)),
                /**
                 * 批量添加数据
                 */
                addBatch: (records) => {
                    return this.#execute(storeName, 'readwrite', (store, tx) => {

                        return new Promise((resolve, reject) => {

                            const total = records.length;

                            if (total === 0) return resolve();

                            for (const record of records) {
                                const request = store.add(record);

                                request.onerror = (e) => {
                                    console.error("[IdbError] 批量写入中途失败:", e);
                                };
                            }

                            // 关键：当整个事务完成时，才代表批量操作成功
                            tx.oncomplete = () => resolve({ count: total, status: 'success' });
                            tx.onabort = () => reject(new Error("事务被中止 (Transaction Aborted)"));
                            tx.onerror = () => reject(tx.error);
                        });
                    });
                },
                /**
                 * 更新数据
                 */
                update: (record) => this.#execute(storeName, 'readwrite', s => s.put(record)),
                /**
                 * 删除数据
                 */
                del: (id) => this.#execute(storeName, 'readwrite', s => s.delete(id)),
                /**
                 * 清空表
                 */
                clear: () => this.#execute(storeName, 'readwrite', s => s.clear()),
                /**
                 * 获取全部
                 */
                getAll: () => this.#execute(storeName, 'readonly', s => s.getAll()),
                /**
                 * 条件查询 (支持索引、范围查询)
                 * @param {string} index 索引名
                 * @param {any} value 查询单字段
                 * @param {object} range 查询范围字段
                 */
                query: ({ index, value, range }) => {
                    return this.#execute(storeName, 'readonly', (store) => {
                        const target = index ? store.index(index) : store;
                        return target.getAll(range || value); // getAll 返回 IDBRequest，#execute 会自动处理
                    });
                },
                /**
                * 根据指定字段 field 的 fieldValue查询，然后更新数据
                * @param {string} fieldIdx 字段名对应的索引名
                * @param {any} fieldValue 该字段对应的值
                * @param {object} newRecord 新的数据内容
                */
                updateByField: (fieldIdx, fieldValue, newRecord) => {
                    // 使用 #execute 统一管理事务和异常
                    return this.#execute(storeName, 'readwrite', (store) => {
                        return new Promise((resolve, reject) => {

                            const index = store.index(fieldIdx);
                            // 先通过索引获取主键 ID
                            const getReq = index.getKey(fieldValue);

                            getReq.onsuccess = () => {
                                const id = getReq.result;

                                // 注入 ID 并更新
                                const recordWithId = id ? { ...newRecord, id } : newRecord;
                                const putReq = store.put(recordWithId);

                                putReq.onsuccess = () => resolve(true);
                                putReq.onerror = () => reject(putReq.error);
                            };

                            getReq.onerror = () => reject(getReq.error);
                        });
                    });
                },
                /**
                 * 根据指定字段删除
                 * @param {string} fieldName 索引字段名
                 * @param {any} fieldValue 该字段对应的值
                 */
                delByField: (fieldName, fieldValue) => {
                    return this.#execute(storeName, 'readwrite', (store) => {
                        return new Promise((resolve, reject) => {
                            const index = store.index(fieldName);
                            const getReq = index.getKey(fieldValue);

                            getReq.onsuccess = () => {
                                const id = getReq.result;
                                if (id === undefined) return resolve(false); // 没找到不代表程序错，返回 false

                                const delReq = store.delete(id);
                                delReq.onsuccess = () => resolve(true);
                                delReq.onerror = () => reject(delReq.error);
                            };
                            getReq.onerror = () => reject(getReq.error);
                        });
                    });
                },
                /**
                * 获取当前表的总条数
                */
                count: () => this.#execute(storeName, 'readonly', s => s.count()),
                /**
                 * 估算当前表的总占用空间 (字节为单位)
                 * 注意：这是通过遍历计算的，表非常大时会有性能开销
                 * @returns {Object} {Bytes KB MB}
                 */
                getSize: () => {
                    return this.#execute(storeName, 'readonly', (store) => {
                        // getAll 返回 IDBRequest，#execute 会自动 handle 它的 onsuccess
                        const req = store.getAll();
                        // 我们需要对结果进行二次加工，所以返回一个 Promise
                        return new Promise((resolve, reject) => {
                            req.onsuccess = () => {
                                const size = new Blob([JSON.stringify(req.result)]).size;
                                resolve({
                                    Bytes: size,
                                    KB: (size / 1024).toFixed(1),
                                    MB: (size / (1024 * 1024)).toFixed(1)
                                });
                            };
                            req.onerror = () => reject(req.error);
                        });
                    });
                },

            };
        }
    }
    // const storage = new LocalStorageManager(storeKey);
    const idbConf = {
        dbName: "GmAwardDB",
        stores: [
            {
                name: 'award_info',
                options: { keyPath: 'id', autoIncrement: true },
                indexes: [{ name: 'idx_name_cleansing', keyPath: 'name_cleansing' }, { name: 'idx_type', keyPath: 'type' }, { name: 'idx_date', keyPath: 'date' }]
            },
            {
                name: 'sys',
                options: { keyPath: 'id', autoIncrement: true },
                indexes: [{ name: 'idx_name', keyPath: 'name' }]
            }
        ]
    }
    const idbstorage = new IdbStorageManager(idbConf);


    const SVG = {
        "金币": `<svg width="100%" height="100%" viewBox="0 0 690 776" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><g><path d="M643.857,515.508c-12.878,-142.519 -83.944,-214.016 -83.944,-214.016l-129.211,-172.281l-172.281,0l-129.211,172.281c0,0 -30.558,30.86 -55.281,92.063c-42.833,14.213 -73.93,54.139 -73.93,101.753c0.037,29.913 12.614,58.482 34.65,78.711c-8.493,15.484 -13,32.84 -13.115,50.5c0,42.166 24.464,78.302 59.76,95.961c27.63,41.391 64.541,54.785 90.986,54.785l344.562,0c29.697,0 72.638,-16.776 100.741,-71.281c41.584,-14.881 71.54,-54.269 71.54,-101c-0.044,-34.737 -16.935,-67.378 -45.267,-87.476Zm-299.295,-386.297c11.844,0 22.784,-3.403 32.303,-8.959c9.54,5.556 20.48,8.959 32.303,8.959c35.684,0 86.141,-50.478 86.141,-86.141c0,-0 0,-43.07 -43.07,-43.07c-16.97,0 -21.535,21.535 -43.07,21.535c-21.535,0 -21.535,-21.535 -64.605,-21.535c-43.07,0 -43.07,21.535 -64.605,21.535c-21.535,0 -26.079,-21.535 -43.07,-21.535c-43.07,0 -43.07,43.07 -43.07,43.07c0,35.662 50.478,86.141 86.141,86.141c11.823,0 22.763,-3.403 32.303,-8.959c9.54,5.556 20.48,8.959 32.303,8.959Z" style="fill: #ecca62;fill-rule:nonzero;"/><path d="M473.773,129.211c0,11.814 -9.721,21.535 -21.535,21.535l-215.351,0c-11.814,0 -21.535,-9.721 -21.535,-21.535c0,-11.814 9.721,-21.535 21.535,-21.535l215.351,0c11.814,0 21.535,9.721 21.535,21.535Z" style="fill: #bf6952;fill-rule:nonzero;"/><path d="M491.27,541.443c0,-107.802 -211.545,-100.771 -211.545,-165.808c0,-31.495 32.073,-46.882 69.299,-46.882c62.569,0 73.712,37.78 102.038,37.78c20.043,0 29.707,-11.871 29.707,-25.187c0,-30.917 -49.897,-54.322 -97.748,-62.413l0,-29.858c0,-18.613 -16.024,-33.711 -35.845,-33.711c-19.845,0 -35.894,15.098 -35.894,33.711l0,30.893c-52.165,11.149 -97.058,45.148 -97.058,100.554c0,103.516 211.496,99.326 211.496,172.045c0,25.211 -29.041,50.397 -76.695,50.397c-71.518,0 -95.332,-45.485 -124.373,-45.485c-14.151,0 -26.798,11.173 -26.798,28.028c0,26.8 47.777,59.018 113.477,67.999l-0.025,0.241l0,33.662c0,18.589 16.074,33.711 35.894,33.711c19.821,0 35.87,-15.122 35.87,-33.711l0,-33.662c0,-0.409 -0.197,-0.722 -0.222,-1.084c59.117,-10.354 108.423,-46.521 108.423,-111.221Z" style="fill: #67757f;fill-rule:nonzero;"/></g></svg>`,
        '血液': `<svg viewBox="0 0 100 120" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/"><g id="SVGRepo_iconCarrier"><path d="M53.911,1.647c-2.027,-2.197 -5.83,-2.195 -7.853,0c-13.774,14.936 -46.058,53.581 -46.058,73.442c0,24.336 22.423,44.135 49.985,44.135c27.561,0 49.985,-19.799 49.985,-44.135c0,-19.867 -32.434,-58.669 -46.058,-73.442Z" style="fill: #f05151;fill-rule:nonzero;"/><g><path d="M74.359,74.03c0,-0.028 -0.039,-2.893 -3.067,-10.06c-1.192,-2.822 0.128,-6.076 2.95,-7.267c2.822,-1.192 6.076,0.128 7.267,2.95c3.43,8.117 3.942,12.492 3.942,14.378c0,3.062 -2.481,5.541 -5.543,5.543l-0.004,0c-3.06,0 -5.542,-2.483 -5.546,-5.543l0.001,-0.001Z" style="fill: #fff;fill-rule:nonzero;"/><path d="M48.182,100.207c8.517,0 16.536,-4.184 21.45,-11.191c1.759,-2.507 5.217,-3.115 7.725,-1.356c2.508,1.759 3.116,5.217 1.356,7.726c-6.988,9.965 -18.402,15.914 -30.532,15.914c-3.063,0 -5.546,-2.483 -5.546,-5.546c0,-3.063 2.483,-5.546 5.546,-5.546l0.001,-0.001Z" style="fill: #fff;fill-rule:nonzero;"/></g></g></svg>`,
        '旅程': `<svg viewBox="0 0 571 459" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;"><g id="SVGRepo_iconCarrier"><path d="M565.033,320.811l-58.649,-117.3c-75.226,7.65 -100.726,22.95 -109.65,34.425c-1.275,2.55 -6.375,8.925 -1.275,24.225c11.476,39.525 0,66.3 -11.475,81.601c-28.05,38.25 -91.8,54.824 -204,54.824c-34.425,0 -58.65,7.65 -66.3,19.125c-7.65,11.476 -2.55,31.875 0,38.25l302.175,0c11.475,0 21.675,-6.375 26.775,-15.3c6.375,-8.925 6.375,-21.675 1.274,-30.6l-20.399,-42.075l110.925,0c11.475,0 21.675,-6.375 26.774,-15.3c8.925,-10.2 8.925,-21.675 3.825,-31.875Z" style="fill: #7dda30;fill-rule:nonzero;stroke:#70b03a;stroke-width:1px;"/><path d="M335.533,306.786c1.275,-2.55 6.375,-8.925 1.275,-26.774c-10.2,-35.7 0,-61.2 10.2,-76.5c20.399,-30.6 61.199,-48.45 131.324,-58.65l-29.324,-59.925c-5.101,-11.475 -16.575,-17.85 -29.325,-17.85c-12.75,0 -22.95,6.375 -29.325,17.85l-52.275,105.825l-82.875,-170.85c-5.1,-11.475 -16.575,-17.85 -29.325,-17.85c-12.75,0 -22.95,6.375 -29.325,17.85l-191.25,388.874c-5.1,10.2 -3.825,21.675 1.275,31.875c6.375,8.925 16.575,15.3 26.775,15.3l17.85,0c-3.825,-19.125 -5.1,-45.899 11.475,-71.399c20.4,-31.875 59.925,-48.45 118.575,-48.45c114.75,-0.001 146.625,-17.851 154.275,-29.326Z" style="fill: #7dda30;fill-rule:nonzero;stroke:#70b03a;stroke-width:1px;"/></g></svg>`,
        '咒术': `<svg viewBox="0 0 200 200" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><g><path d="M100,0c-55.232,0.006 -99.994,44.763 -100,100c0.006,55.231 44.768,99.994 100,100c55.232,-0.006 99.994,-44.769 100,-100c-0.006,-55.237 -44.768,-99.994 -100,-100Zm60.586,39.416c4.734,4.737 8.904,10.023 12.431,15.748l-47.13,0l-15.726,-27.236l-7.823,-13.55c22.748,0.614 43.235,10.035 58.248,25.038Zm-89.937,93.688l-27.985,0l13.993,-24.237l13.992,24.237Zm-27.985,-66.207l27.985,0l-13.991,24.237l-13.994,-24.237Zm19.113,33.104l19.113,-33.104l38.226,0l19.111,33.104l-19.11,33.104l-38.226,0l-19.113,-33.104Zm81.572,8.866l13.99,24.237l-27.985,0l13.995,-24.237Zm-13.995,-41.97l27.985,0l-13.99,24.237l-13.995,-24.237Zm-15.362,-8.869l-27.984,0l13.992,-24.237l13.992,24.237Zm-74.578,-18.612c15.013,-15.003 35.499,-24.424 58.248,-25.038l-7.823,13.55l-15.72,27.236l-47.136,0c3.527,-5.725 7.697,-11.011 12.431,-15.748Zm-25.095,60.584c0.003,-14.804 3.742,-28.7 10.334,-40.836l7.849,13.595l15.727,27.241l-15.726,27.236l-7.849,13.594c-6.593,-12.133 -10.332,-26.029 -10.335,-40.83Zm25.095,60.584c-4.734,-4.737 -8.907,-10.026 -12.431,-15.754l47.136,0l15.72,27.241l7.823,13.55c-22.746,-0.614 -43.235,-10.035 -58.248,-25.038Zm46.594,-18.618l27.984,0l-13.992,24.238l-13.992,-24.238Zm74.577,18.618c-15.013,15.003 -35.502,24.424 -58.248,25.038l7.823,-13.55l15.726,-27.241l47.13,0c-3.524,5.728 -7.697,11.017 -12.431,15.754Zm6.913,-33.349l-15.725,-27.236l15.725,-27.241l7.848,-13.591c6.593,12.133 10.332,26.032 10.335,40.833c-0.003,14.798 -3.742,28.694 -10.335,40.827l-7.848,-13.591Z" style="fill: #c779fe;fill-rule:nonzero;"/></g></svg>`,
        '知识': `<svg width="100%" height="100%" viewBox="0 0 598 673" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><g><path d="M44.589,43.473c10.683,-10.356 25.681,-17.109 54.006,-20.801c29.157,-3.8 67.799,-3.859 123.205,-3.859l154.4,0c55.407,0 94.05,0.059 123.206,3.859c28.324,3.691 43.321,10.444 54.004,20.801c10.683,10.357 17.648,24.897 21.458,52.355c3.918,28.266 3.981,65.728 3.981,119.442l0,358.64c0,0 -559.697,30.053 -559.697,34.478l0,-393.119c0,-53.714 0.062,-91.177 3.982,-119.442c3.808,-27.458 10.773,-41.999 21.456,-52.355Z" style="fill:#0093ff;fill-rule:nonzero;"/><path d="M138.995,573.912l439.853,0c-0.123,18.656 -0.755,32.567 -3.967,43.561c-3.823,13.088 -10.816,20.021 -21.538,24.958c-10.725,4.937 -25.782,8.156 -54.214,9.915c-29.269,1.812 -68.063,1.84 -123.683,1.84l-154.994,0c-55.62,0 -94.412,-0.028 -123.681,-1.84c-28.432,-1.76 -43.489,-4.979 -54.214,-9.915c-10.724,-4.937 -17.716,-11.868 -21.539,-24.958c-0.288,-0.983 -0.553,-1.991 -0.8,-3.023c-1.402,-5.843 -2.103,-8.768 2.323,-15.66c4.427,-6.89 6.346,-7.971 10.184,-10.135c11.383,-6.414 26.995,-11.162 44.954,-13.377c10.155,-1.252 23.407,-1.366 61.314,-1.366l-0.002,0Z" style="fill:#aeaeae;fill-rule:nonzero;"/><path d="M357.736,49.944l-205.12,307.609l103.907,-24.324l-22.95,202.33l211.812,-309.193l-103.924,24.328l16.276,-200.751l-0.001,0.001Z" style="fill:#ddfdff;fill-rule:nonzero;"/></g></svg>`,
        '灵魂': `<svg fill="#9df3ff" viewBox="0 0 28 23" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><g id="SVGRepo_iconCarrier"><path d="M25.606,3.606c0.066,-0.15 0.207,-0.308 0.19,-0.446c-0.058,-0.229 -0.092,-0.494 -0.092,-0.765c0,-0.171 0.014,-0.34 0.038,-0.505l-0.003,0.018l1.044,1.13l-0.046,-0.034c0.659,1.15 0.653,2.412 0.632,3.685c-0.014,1.055 -0.435,2.008 -1.114,2.712l0.001,-0.001c-0.452,0.494 -0.951,0.946 -1.406,1.437c-1.029,1.101 -0.888,1.998 0.425,2.777c0.245,0.144 0.509,0.256 0.839,0.42c0.541,1.932 0.417,3.896 0.04,5.821c-0.799,0.742 -1.719,0.624 -2.639,0.653c-0.028,0.004 -0.06,0.006 -0.093,0.006c-0.369,0 -0.673,-0.28 -0.712,-0.638l0,-0.003c-0.074,-0.388 0.222,-0.595 0.555,-0.727c0.246,-0.067 0.461,-0.159 0.659,-0.277l-0.012,0.007c0.5,-0.385 0.946,-0.814 0.862,-1.547c-0.084,-0.733 -0.632,-1.023 -1.15,-1.346c-0.085,-0.036 -0.183,-0.058 -0.286,-0.063l-0.002,0c-1.229,-0.223 -2.315,-0.72 -3.231,-1.427l0.017,0.013c-0.42,0.382 -0.319,0.739 -0.152,1.086c0.399,0.831 0.336,1.567 -0.405,2.182c-0.039,0.027 -0.072,0.063 -0.094,0.104l-0.001,0.002c-0.845,1.952 -2.403,1.4 -3.991,1.185c0.391,-0.52 0.934,-0.908 1.562,-1.098l0.021,-0.006c0.256,-0.074 0.475,-0.163 0.683,-0.269l-0.021,0.01c0.649,-0.359 0.831,-0.862 0.497,-1.538c-0.236,-0.463 -0.547,-0.885 -0.894,-1.437c-0.725,0.127 -1.469,0.218 -2.185,0.414c-0.237,0.136 -0.397,0.383 -0.408,0.668l0,0.002c0.305,1.639 -0.506,2.84 -1.472,3.999c-0.116,0.139 -0.221,0.296 -0.307,0.463l-0.007,0.015c-0.529,1.015 -1.15,1.808 -2.489,1.777c-0.477,0 -0.966,0.351 -1.437,0.532l-1.541,-1.11c0.121,-0.247 0.239,-0.547 0.402,-0.822c0.322,-0.541 0.779,-0.731 1.437,-0.69c1.498,0.086 2.369,-0.771 2.487,-2.263c0.063,-0.799 -0.443,-1.207 -1.006,-1.688c-0.376,1.058 -1.377,1.041 -2.187,1.337c-0.21,0.032 -0.457,0.053 -0.707,0.057l-0.005,0c-0.661,0.135 -0.822,0.42 -0.828,1.198c-0.043,0.411 -0.116,0.784 -0.221,1.144l0.011,-0.045c-0.951,-0.526 -0.991,-0.693 -0.748,-2.78c0.713,-0.684 1.84,-0.972 2.28,-1.99c-0.287,-0.862 -0.96,-0.848 -1.547,-0.644c-0.94,0.328 -1.832,0.79 -2.737,1.21c-0.506,0.233 -1.001,0.497 -1.489,0.739c-0.713,-1.046 -0.713,-1.046 -0.04,-1.725c0.578,-0.222 1.009,-0.71 1.147,-1.31l0.003,-0.013c-1.437,0.342 -1.437,0.368 -1.116,1.357l-1.023,0l-0.543,1.075c-1.173,-1.11 -1.27,-1.437 -0.756,-2.763c0.725,-1.857 1.725,-3.51 3.573,-4.465c0.176,-0.123 0.33,-0.259 0.466,-0.411l0.003,-0.003c-0.015,-0.112 -0.024,-0.241 -0.024,-0.373c0,-0.707 0.25,-1.356 0.666,-1.863l-0.004,0.005c0.195,-0.303 0.327,-0.665 0.367,-1.053l0.001,-0.01c0.245,-1.702 1.198,-2.975 2.418,-4.108c0.239,-0.249 0.525,-0.449 0.846,-0.586l0.017,-0.006c-0.364,0.589 -0.737,1.294 -1.07,2.022l-0.051,0.126c-0.233,0.658 -0.473,1.509 -0.668,2.377l-0.031,0.163c0.908,0 1.36,-0.44 1.802,-0.932c1.394,-1.544 3.289,-2.299 5.132,-3.182l-2.588,2.763c1.676,0.75 2.012,0.713 3.194,-0.48c0.861,-0.826 1.926,-1.447 3.11,-1.779l0.052,-0.012c-0.834,1.162 -2.257,1.779 -2.737,3.292l0.575,0.627c0.268,-0.149 0.595,-0.304 0.931,-0.438l0.061,-0.021c0.092,-0.032 0.256,0.155 0.388,0.239l-0.302,0.287l-0.23,0.089l0.129,0.101l0.063,-0.224l0.287,-0.287c0.826,-0.63 1.661,-1.234 2.958,-1.369c-0.862,0.94 -1.921,1.532 -2.377,2.723l0.601,0.124l-0.032,-0.043l0.353,0.601c0.71,-0.515 1.173,-1.403 2.263,-1.409l-1.021,1.257l1.926,0.713c0.198,-0.121 0.435,-0.248 0.68,-0.361l0.044,-0.018c0.226,-0.079 0.522,-0.163 0.823,-0.23l0.06,-0.011l-0.701,0.978c0.092,0.089 0.146,0.184 0.21,0.19c0.27,0.032 0.583,0.05 0.901,0.05c0.033,0 0.066,0 0.099,-0.001l-0.005,0c1.958,-0.063 3.738,-2.075 2.17,-4.329l-0.021,0.011Z" style="fill-rule:nonzero;"/><path d="M26.784,3.039l0.092,-0.224l-0.127,0.19l0.034,0.034Z" style="fill-rule:nonzero;"/><path d="M25.629,3.583l-0.207,-0.095l0.121,-0.089l0.063,0.207l0.023,-0.023Z" style="fill-rule:nonzero;"/><path d="M17.869,6.199l0.112,-0.21l-0.146,0.175l0.034,0.034Z" style="fill-rule:nonzero;"/></g></svg>`,
        '堕落': `<svg viewBox="0 0 31 26" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><g id="SVGRepo_iconCarrier"><path d="M28.971,3.593c-2.31,-3.055 -6.424,-4.349 -10.013,-3.149c-1.534,0.514 -2.769,1.452 -3.676,2.681c-0.888,-1.119 -2.063,-1.979 -3.504,-2.461c-3.588,-1.202 -7.702,0.092 -10.012,3.148c-2.24,2.967 -1.943,5.766 -1.3,7.594c0.706,2.006 2.304,3.954 3.49,4.251c0.94,0.231 1.901,-0.334 2.139,-1.28c0.207,-0.82 -0.199,-1.655 -0.932,-2.012c-0.299,-0.26 -1.349,-1.403 -1.586,-2.981c-0.179,-1.192 0.15,-2.318 1.002,-3.447c1.387,-1.833 3.942,-2.643 6.076,-1.931c1.902,0.638 2.948,2.356 2.948,4.835l0,14.475c0,0.976 0.789,1.762 1.764,1.762c0.976,0 1.764,-0.787 1.764,-1.762l0,-14.69c0,-2.48 1.047,-4.196 2.948,-4.835c2.138,-0.712 4.69,0.097 6.076,1.931c0.854,1.13 1.18,2.258 1.002,3.445c-0.238,1.582 -1.287,2.724 -1.583,2.981c-0.732,0.358 -1.14,1.192 -0.933,2.014c0.238,0.946 1.195,1.518 2.141,1.28c1.186,-0.299 2.782,-2.246 3.49,-4.251c0.641,-1.829 0.939,-4.63 -1.3,-7.592l0,-0.004Z" style="fill: #ea37ea;fill-rule:nonzero;"/></g></svg>`,
        '总计': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="#00b8f0" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.207 19.793a.707.707 0 0 1-1.207-.5V16a1 1 0 0 0-1-1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h6a1 1 0 0 0 1-1V4.707a.707.707 0 0 1 1.207-.5l6.94 6.94a1.207 1.207 0 0 1 0 1.707z"/></svg>`,
        '缺图': `<svg width="41px" height="41px" viewBox="0 0 200 200" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><g><g><path d="M177.766,181.5l-155.533,0c-2.045,0 -3.703,-2.281 -3.703,-5.094l0,-152.812c0,-2.813 1.658,-5.094 3.703,-5.094l155.534,0c2.045,0 3.703,2.281 3.703,5.094l0,152.812c-0,2.813 -1.658,5.094 -3.704,5.094Z" style="fill:#00c3ff;fill-rule:nonzero;"/><ellipse cx="49.884" cy="51.213" rx="19.37" ry="20.211" style="fill:#8be4ff;"/><ellipse cx="49.884" cy="51.213" rx="10.931" ry="11.405" style="fill:#fff;"/><path d="M181.47,176.416l0,-37.851l-33.958,-74.404c-1.795,-6.048 -9.284,-6.113 -13.436,-0.025l-98.483,117.364l142.173,0c2.045,0 3.703,-2.277 3.703,-5.084Z" style="fill:#96ff69;fill-rule:nonzero;"/></g><path d="M74.431,80.681l10.827,-62.181l33.045,0l-18.303,59.591l35.097,56.767l-20.507,46.642l-20.803,0l18.441,-44.521l-37.798,-56.298Z" style="fill:#494949;"/></g></svg>`,
        '设置': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></g></svg>`,

    }
    const SVGControlPanel = {
        'light': `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M19 9.199h-.98c-.553 0-1 .359-1 .801c0 .441.447.799 1 .799H19c.552 0 1-.357 1-.799c0-.441-.449-.801-1-.801M10 4.5A5.483 5.483 0 0 0 4.5 10c0 3.051 2.449 5.5 5.5 5.5c3.05 0 5.5-2.449 5.5-5.5S13.049 4.5 10 4.5m0 9.5c-2.211 0-4-1.791-4-4c0-2.211 1.789-4 4-4a4 4 0 0 1 0 8m-7-4c0-.441-.449-.801-1-.801H1c-.553 0-1 .359-1 .801c0 .441.447.799 1 .799h1c.551 0 1-.358 1-.799m7-7c.441 0 .799-.447.799-1V1c0-.553-.358-1-.799-1s-.801.447-.801 1v1c0 .553.359 1 .801 1m0 14c-.442 0-.801.447-.801 1v1c0 .553.359 1 .801 1c.441 0 .799-.447.799-1v-1c0-.553-.358-1-.799-1m7.365-13.234c.391-.391.454-.961.142-1.273s-.883-.248-1.272.143l-.7.699c-.391.391-.454.961-.142 1.273s.883.248 1.273-.143zM3.334 15.533l-.7.701c-.391.391-.454.959-.142 1.271s.883.25 1.272-.141l.7-.699c.391-.391.454-.961.142-1.274s-.883-.247-1.272.142m.431-12.898c-.39-.391-.961-.455-1.273-.143s-.248.883.141 1.274l.7.699c.391.391.96.455 1.272.143s.249-.883-.141-1.273zm11.769 14.031l.7.699c.391.391.96.453 1.272.143c.312-.312.249-.883-.142-1.273l-.699-.699c-.391-.391-.961-.455-1.274-.143s-.248.882.143 1.273"/></svg>`,
        'dark': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none"><path d="M20.539 14.852A8 8 0 0 1 11 7c0-1.457.32-2.823 1-4a9 9 0 1 0 8.539 11.852"/><path stroke="currentColor" stroke-width="2" d="M20.539 14.852A8 8 0 0 1 11 7c0-1.457.32-2.823 1-4a9 9 0 1 0 8.539 11.852ZM16.625 4l.044.08l.081.045l-.08.044l-.045.081l-.044-.08l-.081-.045l.08-.044zM20.5 8.5l.177.323L21 9l-.323.177l-.177.323l-.177-.323L20 9l.323-.177z"/></g></svg>`,
        '权重': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path fill="currentColor" d="M256 336h-.02c0-16.18 1.34-8.73-85.05-181.51c-17.65-35.29-68.19-35.36-85.87 0C-2.06 328.75.02 320.33.02 336H0c0 44.18 57.31 80 128 80s128-35.82 128-80M128 176l72 144H56zm511.98 160c0-16.18 1.34-8.73-85.05-181.51c-17.65-35.29-68.19-35.36-85.87 0c-87.12 174.26-85.04 165.84-85.04 181.51H384c0 44.18 57.31 80 128 80s128-35.82 128-80zM440 320l72-144l72 144zm88 128H352V153.25c23.51-10.29 41.16-31.48 46.39-57.25H528c8.84 0 16-7.16 16-16V48c0-8.84-7.16-16-16-16H383.64C369.04 12.68 346.09 0 320 0s-49.04 12.68-63.64 32H112c-8.84 0-16 7.16-16 16v32c0 8.84 7.16 16 16 16h129.61c5.23 25.76 22.87 46.96 46.39 57.25V448H112c-8.84 0-16 7.16-16 16v32c0 8.84 7.16 16 16 16h416c8.84 0 16-7.16 16-16v-32c0-8.84-7.16-16-16-16"/></svg>`,
        '设置': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></g></svg>`,
        '放大镜': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m21 21l-4.34-4.34"/><circle cx="11" cy="11" r="8"/></g></svg>`,
        '定位': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 15l6 6M15 9l6-6m0 13v5h-5m5-13V3h-5M3 16v5h5m-5 0l6-6M3 8V3h5m1 6L3 3"/></svg>`,
        '图片': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></g></svg>`,
        '本地': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="m9 13l2 2l4-4"/></g></svg>`,
        '文件夹': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M13 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v1.36M19 12v6m0-4h2"/><circle cx="19" cy="20" r="2"/></g></svg>`,
        '数据库': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 12a9 3 0 0 0 5 2.69M21 9.3V5"/><path d="M3 5v14a9 3 0 0 0 6.47 2.88M12 12v4h4"/><path d="M13 20a5 5 0 0 0 9-3a4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"/></g></svg>`,
        '快捷键': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10" stroke-width="1.5"><path d="M20.05.75H3.95c-1.8 0-3.2 1.4-3.2 3.2v16.1c0 1.8 1.4 3.2 3.2 3.2h16.1c1.8 0 3.2-1.4 3.2-3.2V3.95c0-1.7-1.4-3.2-3.2-3.2"/><path d="M16.55 14.25c1.2 0 2.2 1 2.2 2.2s-1 2.2-2.2 2.2s-2.2-1-2.2-2.2v-9c0-1.2 1-2.2 2.2-2.2s2.2 1 2.2 2.2s-1 2.2-2.2 2.2h-9c-1.2 0-2.2-1-2.2-2.2s1-2.2 2.2-2.2s2.2 1 2.2 2.2v9c0 1.2-1 2.2-2.2 2.2s-2.2-1-2.2-2.2s1-2.2 2.2-2.2z"/></g></svg>`,
        '下箭头': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9l6 6l6-6"/></svg>`,
        '关于': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h512v512H0z" fill="none"/><path fill="currentColor" fill-rule="evenodd" d="M256 42.667C138.18 42.667 42.667 138.179 42.667 256c0 117.82 95.513 213.334 213.333 213.334c117.822 0 213.334-95.513 213.334-213.334S373.822 42.667 256 42.667m0 384c-94.105 0-170.666-76.561-170.666-170.667S161.894 85.334 256 85.334c94.107 0 170.667 76.56 170.667 170.666S350.107 426.667 256 426.667m26.714-256c0 15.468-11.262 26.667-26.497 26.667c-15.851 0-26.837-11.2-26.837-26.963c0-15.15 11.283-26.37 26.837-26.37c15.235 0 26.497 11.22 26.497 26.666m-48 64h42.666v128h-42.666z"/></svg>`,
        '网站': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M0 0h48v48H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-width="3"><path stroke-linejoin="round" d="M3 24a21 21 0 1 0 42 0a21 21 0 1 0-42 0"/><path stroke-linejoin="round" d="M15 24a9 21 0 1 1 18 0a9 21 0 1 1-18 0"/><path stroke-linecap="round" d="M4.5 31h39m-39-14h39"/></g></svg>`,
        '链接': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M20.5 3.5L3.5 9l6.5 3l7-5l-5 7l3 6.5z"/></svg>`
    }

    const ATTR_MAP = {
        '金币': { color: '#ecca62', emoji: SVG['金币'] },
        '血液': { color: '#f05151', emoji: SVG['血液'] },
        '旅程': { color: '#70b03a', emoji: SVG['旅程'] },
        '咒术': { color: '#c779fe', emoji: SVG['咒术'] },
        '知识': { color: '#8c8cff', emoji: SVG['知识'] },
        '灵魂': { color: '#8ad6e0', emoji: SVG['灵魂'] },
        '堕落': { color: '#ea37ea', emoji: SVG['堕落'] },
        '总计': { color: '#f29740', emoji: SVG['总计'] }
    };

    /** 并发请求限制 */
    const limit = pLimit(6);

    /**
     * 控制面板默认配置的结构
     * @type {{ weights: Record<'金币'|'血液'|'旅程'|'咒术'|'知识'|'灵魂'|'堕落', { value: number, enabled: boolean }>,basic: { medalMagnifier: boolean, positionMode: 'left'|'right', showImage: boolean, localImageMode: boolean, handleName: string|null, shortcut: string },theme: { magnifierTheme: string },activeTab: string}}
     */
    const DEFAULT_CONFIG = {
        weights: {
            '金币': { value: 1, enabled: true },
            '血液': { value: 1, enabled: true },
            '旅程': { value: 30, enabled: true },
            '咒术': { value: 5, enabled: true },
            '知识': { value: 50, enabled: true },
            '灵魂': { value: 1000, enabled: true },
            '堕落': { value: 0, enabled: false }
        },
        basic: { medalMagnifier: true, positionMode: 'left', showImage: true, localImageMode: false, handleName: null, shortcut: 'Alt + S' },
        theme: { magnifierTheme: 'light' },
        activeTab: "weight",
    };

    /**
     * ToastManager Toast提示组件
     */
    class ToastManager {
        /**
         * @param {string} id - Toast 容器 id
         */
        constructor(id = "toast-host") {
            this.id = id
            this.container = null;
            this.shadow = null;
            this.template = null; // 预留模板引用
            this._setup();
        }

        _setup() {
            const host = document.createElement('div');
            host.id = this.id;
            if (!document.body) return;
            document.body.appendChild(host);

            this.shadow = host.attachShadow({ mode: 'open' });

            // 注入样式
            const style = document.createElement('style');
            style.textContent = `
                :host, .toast-scope {
                    --t-success: #10b981;
                    --t-info: #3b82f6;
                    --t-warning: #f59e0b;
                    --t-error: #ef4444;
                    --t-progress-bar: #9d9d9d;
                    --t-radius: 4px;
                }
                #toast-container {
                    position: fixed; top: 20px; right: 20px; z-index: 999999;
                    display: flex; flex-direction: column; gap: 12px; pointer-events: none;
                }
                .toast-card {
                    width: 320px; background: #ffffff; border-radius: var(--t-radius);
                    box-shadow: 0 5px 15px 5px rgba(0,0,0,0.15); overflow: hidden;
                    pointer-events: auto; position: relative; display: flex;
                    transition: 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    font-family: system-ui, sans-serif;
                }
                .toast-sidebar { width: 6px; flex-shrink: 0; }
                .toast-content { flex: 1; padding: 14px; display: flex; align-items: center; gap: 12px; }
                .toast-icon { font-size: 24px; line-height: 1; }
                .toast-text { flex: 1; }
                .toast-title { font-weight: 800; font-size: 14px; color: #1e293b; line-height: 1.2; }
                .toast-msg { font-size: 13px; color: #4f5661; margin-top: 6px; }
                /* 垂直水平居中的关闭按钮 */
                .toast-close {
                    width: 38px; align-self: stretch; display: flex;
                    align-items: center; justify-content: center;
                    cursor: pointer; color: #94a3b8; font-size: 16px; transition: 0.2s;
                }
                .toast-close:hover { color: var(--t-error); background: #fff1f2; }
                .toast-progress-wrap { position: absolute; bottom: 0; left: 5px; right: 0; height: 3px; background: #f1f5f9; }
                .toast-progress-line { height: 100%; width: 100%; background: var(--t-progress-bar); transition: linear; }
            `;
            this.shadow.appendChild(style);

            this.template = document.createElement('template');
            this.template.innerHTML = `
                <div class="toast-card">
                    <div class="toast-sidebar"></div>
                    <div class="toast-content">
                        <div class="toast-icon"></div>
                        <div class="toast-text">
                            <div class="toast-title"></div>
                            <div class="toast-msg"></div>
                        </div>
                    </div>
                    <div class="toast-close">✕</div>
                    <div class="toast-progress-wrap"><div class="toast-progress-line"></div></div>
                </div>
            `.trim();

            // 创建容器
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-scope';
            this.shadow.appendChild(this.container);
        }
        /**
         * 显示弹窗
         * @param {Object} options - 弹窗配置参数对象
         * @param {'info'|'success'|'warning'|'error'} [options.type='info'] - 弹窗类型
         * @param {string} options.title - 弹窗标题
         * @param {string} options.msg - 弹窗消息内容
         * @param {number} [options.duration=2000] - 持续显示时间（毫秒）
         */
        show({ type = 'info', title, msg, duration = 2000 }) {
            const configs = {
                success: { color: 'var(--t-success)', icon: '✓', label: '成功' },
                info: { color: 'var(--t-info)', icon: 'ｉ', label: '信息' },
                warning: { color: 'var(--t-warning)', icon: '⚠', label: '警告' },
                error: { color: 'var(--t-error)', icon: '✖', label: '错误' }
            };
            const cfg = configs[type] || configs.info;

            const cloneFragment = this.template.content.cloneNode(true);
            const toast = cloneFragment.querySelector('.toast-card');
            toast.querySelector('.toast-sidebar').style.backgroundColor = cfg.color;

            const iconEl = toast.querySelector('.toast-icon');
            iconEl.style.color = cfg.color;
            iconEl.textContent = cfg.icon;

            toast.querySelector('.toast-title').textContent = title || cfg.label;
            toast.querySelector('.toast-msg').textContent = msg;

            const bar = toast.querySelector('.toast-progress-line');

            bar.style.width = '100%';
            bar.style.transition = 'none';

            setTimeout(() => {
                // 让 CSS 自动在 duration 毫秒内，平滑地（linear保证匀速）将宽度变为 0
                bar.style.transition = `width ${duration}ms linear`;
                bar.style.width = '0%';
            }, 50);

            let timerId = setTimeout(() => {
                this.hide(toast);
            }, duration);

            // 悬停暂停/恢复
            let startTime = Date.now();
            let timeLeft = duration;

            toast.onmouseenter = () => {
                clearTimeout(timerId);
                const elapsed = Date.now() - startTime;
                timeLeft -= elapsed;

                const computedWidth = getComputedStyle(bar).width;
                bar.style.transition = 'none';
                bar.style.width = computedWidth;
            };

            toast.onmouseleave = () => {
                startTime = Date.now();

                setTimeout(() => {
                    bar.style.transition = `width ${timeLeft}ms linear`;
                    bar.style.width = '0%';
                }, 10);

                timerId = setTimeout(() => {
                    this.hide(toast);
                }, timeLeft);
            };

            toast.querySelector('.toast-close').onclick = () => {
                clearTimeout(timerId);
                this.hide(toast);
            };

            this.container.prepend(toast);
        }
        /**
         * 隐藏弹窗
         * @param {*} toast
         */
        hide(toast) {
            toast.style.transform = 'translateX(110%)';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 200);
        }
    }
    /**
     * ControlPanel 控制面板组件：外观配置与权重控制
     */
    class ControlPanel {
        /**
         * @param {Object} [config={}] - 配置对象
         * @param {ToastManager} [config.toastInstance] - 注入 Toast 实例
         * @param {string} [config.storageKey="ULTRA_CONFIG_V3"] - localstorage 的存储 ID
         * @param {string} [config.id="medal-setting-panel"] - ControlPanel 的 DOM 元素 ID
         * @param {LocalFileSystem} [config.localFile] 注入 本地图片文件class 实例
         */
        constructor(config = {}) {
            this.toast = config.toastInstance || new ToastManager();
            this.storageKey = config.storageKey || "ULTRA_CONFIG_V3";
            this.id = config.id || "medal-setting-panel";
            this.localFile = config.localFile;

            /** @type {typeof DEFAULT_CONFIG} */
            this.data = null;

            this.tabRegistry = {
                basic: {
                    label: '基础',
                    icon: SVGControlPanel['设置'],
                    render: () => this._getBasicHTML(),
                    bind: () => this._bindBasicEvents(),
                },
                weight: {
                    label: '权重',
                    icon: SVGControlPanel['权重'],
                    render: () => this._getWeightHTML(),
                    bind: () => this._bindWeightEvents()
                },
                about: {
                    label: '关于',
                    icon: SVGControlPanel['关于'],
                    render: () => this._getAboutHTML(),
                },
            };
            this.isHide = true;
            this._init();

        }
        async _init() {
            let host = document.getElementById(this.id);

            if (!host) {
                host = document.createElement('div');
                host.id = this.id;

                if (!document.body) { console.warn('Document body not found.'); return; }
                document.body.appendChild(host);
            } else {
                host.innerHTML = '';
            }
            if (!host.shadowRoot) {
                this.shadow = host.attachShadow({ mode: 'open' });
            } else {
                this.shadow = host.shadowRoot;
            }

            this._CommonStyles();
            this._CommonRender();
            await this._loadData();
            this._BindCommonEvents();

            if (!this.content || !this.tabRegistry) return;

            this.content.innerHTML = '';

            Object.entries(this.tabRegistry).forEach(([tabKey, tab]) => {

                const tabWrapper = document.createElement('div');
                tabWrapper.className = 'tab-panel-wrapper';
                tabWrapper.dataset.tab = tabKey;

                if (tabKey !== this.data.activeTab) {
                    tabWrapper.style.display = 'none';
                    tabWrapper.style.opacity = '0';
                }

                tabWrapper.innerHTML = tab?.render?.() || '';
                this.content.appendChild(tabWrapper);

                tab?.bind?.(tabWrapper);
            });

        }
        async _loadData() {
            const saved = localStorage.getItem(this.storageKey);
            let userConfig = {};

            try {
                userConfig = saved ? JSON.parse(saved) : {};
            } catch (e) {
                console.error("配置解析失败，重置为默认值", e);
            }

            this.data = {
                ...DEFAULT_CONFIG,
                weights: { ...DEFAULT_CONFIG.weights, ...(userConfig?.weights || {}) },
                basic: { ...DEFAULT_CONFIG.basic, ...(userConfig?.basic || {}) },
                theme: { ...DEFAULT_CONFIG.theme, ...(userConfig?.theme || {}) },

                activeTab: userConfig?.activeTab || DEFAULT_CONFIG.activeTab
            };
            this.handleName = await this.localFile.getHandleName();
        }

        _saveData() {
            localStorage.setItem(this.storageKey, JSON.stringify(this.data));
        }

        _CommonStyles() {
            const style = document.createElement('style');
            style.textContent = `
                :host {
                    --up-accent: #1d7db9;
                    --up-orange: #e06713;
                    --up-bg-gray: #f0f0f0;
                    --up-border: #d0d8e1;
                    --up-radius: 6px;
                    --up-error: #ef4444;
                    --win-bg: #f3f3f3;
                    --win-bg-hover: #e9e9e9;
                    --win-card: #f5faff;
                    --win-accent: #0078d4;
                    --win-border: #e5e5e5;
                    --win-radius: 6px;
                    --text-title: #1b1b1b;
                    --text-main: #222222;
                    --text-secondary: #94a3b8;
                }
                #overlay {
                    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
                    display: none; justify-content: center; align-items: center;
                    z-index: 999990; backdrop-filter: blur(4px); opacity: 0; transition: 0.3s;
                }
                #modal {
                    background: var(--up-bg-gray); width: 570px; height: 580px;
                    border-radius: var(--up-radius); display: flex; flex-direction: column;
                    box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
                    transition: 0.4s; padding: 15px;
                }
                #modal , .win-btn {
                    font-family: 'DengXian', '等线', system-ui, sans-serif;
                }
                /* 导航栏样式 */
                .nav { display: flex; align-items: center; margin-bottom: 8px; }
                .nav-item {
                    padding: 5px 15px; cursor: pointer; font-size: 16px; font-weight: 600;
                    color: var(--text-secondary); transition: 0.2s; position: relative;display: flex;gap: 6px;
                }
                .nav-item:not(.active):hover { background: var(--win-bg-hover) ; color: var(--text-title); border-radius: var(--up-radius); }
                .nav-item.active { color: var(--up-accent); }
                .nav-item.active::after {
                    content: ''; position: absolute; bottom: -11px; left: 15px; right: 15px;
                    height: 3px; background: var(--up-accent); border-radius: 10px;
                }
                .nav-close , .nav-theme { border-radius: 4px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-secondary); }
                .nav-close { margin-left: auto; color: var(--text-main); }
                .nav-theme { margin-left: 20px; };
                .nav-theme:hover { background: var(--win-bg-hover); }
                .nav-close:hover { background: #fee2e2; color: var(--up-error); }
                .nav svg { width:20px; height:20px; display:inline-flex; }

                .line { height:1px; border-bottom: 2px solid var(--up-border); margin-bottom: 18px }

                /* 内容区 */
                .main { overflow-y: auto;}
                .main .tab-panel-wrapper { display: flex; flex-direction: column; gap: 6px; padding: 0 6px;}
                .main::-webkit-scrollbar {
                    width: 10px;
                    height: 10px;
                }
                .main::-webkit-scrollbar-thumb {
                    border-radius: 5px;
                    background: rgba(157, 157, 157, 0.87);
                }
                .main::-webkit-scrollbar-track {
                    border-radius: 5px;
                    background: rgba(21, 21, 21, 0);
                }
                .main::-webkit-scrollbar-corner {
                    background: rgba(21, 21, 21, 0);
                }
                .main::-webkit-scrollbar-thumb:hover {
                    background-color: rgba(92, 92, 92, 0.95);
                }
                @supports (scrollbar-width: thin) and (not selector(::-webkit-scrollbar-thumb)) {
                    .main {
                        scrollbar-color: rgba(157, 157, 157, 0.87) rgba(21, 21, 21, 0) ;
                    }
                }

                .disabled { opacity: 0.8; filter: grayscale(1); }

                .row { display: flex; align-items: center; padding: 13px; background: var(--win-card); border: 1px solid var(--up-border); border-radius: var(--up-radius);margin-bottom: 4px; }
                .row:hover { border-color: var(--up-accent) }
                .row svg { width:22px; height:22px; display:inline-flex; margin-right: 6px; }
                .row .row-label{ flex:1; font-weight:600; font-size:14px; }
                .row-controls { display: flex; align-items: center; gap: 8px; }
                /* 输入框去掉箭头 */
                .input-num {
                    width: 50px; text-align: center; border: 1px solid var(--up-border);
                    border-radius: 4px; padding: 5px; font-weight: bold;
                    appearance: textfield; -moz-appearance: textfield;
                }
                .input-num::-webkit-outer-spin-button, .input-num::-webkit-inner-spin-button { -webkit-appearance: none; }

                /* 按钮 */
                .ste-btn {
                    width:26px; height:26px; background:#fff; cursor:pointer;
                    border:1px solid var(--up-border); border-radius: 4px;
                }
                .ste-btn:hover { background: rgba(0, 0 , 0, 0.04) }
                .btn {
                    border: none; padding: 10px 22px; border-radius: var(--up-radius); cursor: pointer;
                    font-weight: 700; transition: 0.2s; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
                }
                .btn:hover { transform: translateY(-2px); filter: brightness(1.1); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.2); }
                .btn:active { transform: translateY(0); }
                .btn-save { background: var(--up-accent); color: #fff; }
                .btn-reset { background: var(--up-orange); color: #fff; }

                /* Switch */
                .switch { position: relative; width: 40px; height: 20px; cursor: pointer; margin-left: 10px; }
                .switch input { opacity: 0; width: 0; height: 0; }
                .slider { position: absolute; inset: 0; background: #cbd5e1; border-radius: 20px; transition: 0.3s; }
                .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background: #fff; transition: 0.3s; border-radius: 50%; }
                input:checked + .slider { background: var(--up-accent); }
                input:checked + .slider:before { transform: translateX(20px); }
                .tab-footer { display:flex; justify-content:flex-end; gap:12px; margin-top: 10px; }

                /* 卡片 */
                .card {
                    background: var(--win-card); border: 1px solid var(--win-border);
                    border-radius: 6px; padding: 11px 16px;
                    display: flex; align-items: center; justify-content: space-between; gap: 12px; transition: background-color 0.2s, color 0.2s;
                    user-select: none; -webkit-user-select: none;
                }
                .card:hover { border-color: var(--up-accent) }
                .card-icon { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; position: relative; }
                .card-info { flex: 1; }
                .card-title { font-size: 14px; color: var(--text-title); font-weight: 700;}
                .card-desc { font-size: 13px; color: var(--text-main); margin-top: 3px; line-height: 1.3;}
                .card-title, .card-desc { user-select: text; -webkit-user-select: text; }
                .card svg {display: inline-flex; width: 20px; height: 20px;}

                /* 聚合卡片 */
                .card-group { flex-direction: column; padding: 0 !important; gap: 0 !important; overflow: hidden; }
                .card-item { display: flex; align-items: center; width: 100%; padding: 12px 16px; box-sizing: border-box; gap: 12px; }
                .card-group .card-item.indent { border-top: 1.5px solid var(--win-border); padding: 8px 16px 8px 54px; }
                .card-group.is-open .card-item:hover { background: rgba(0, 0, 0, 0.03); }

                /* 下拉组件 */
                .drop-selected { display: flex; gap: 6px; justify-content: space-between; align-items: center; }
                .drop-list { position: fixed; background: #fff; border: 1px solid var(--win-border); border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); display: none; flex-direction: column; z-index: 10; }
                .drop-item { padding: 8px 15px; font-size: 13px; cursor: pointer; }
                .drop-item:hover { background: var(--win-accent); color: #fff; }
                .drop-selected svg {width: 12px; height: 12px;}

                .expandable { display: flex; width: 100%; max-height: 0; overflow: hidden; transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1); opacity: 0; pointer-events: none; }
                .expandable.open { max-height: 100px; opacity: 1; pointer-events: auto; }

                .win-btn { line-height: 1; background: #fff; border: 1px solid var(--win-border); padding: 6px 16px; border-radius: 4px; font-size: 13px; cursor: pointer;border-bottom: 2px solid var(--up-accent); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; user-select: none; }
                .win-btn:hover { background: #f3f3f3; }
                .win-btn-primary { background: var(--win-accent); color: #fff; border: none; }
                .win-btn-primary:hover { background: #006abc; }

                /* 快捷键组件：kbd */
                .kbd { color: var(--win-accent); white-space: nowrap; transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease, opacity 0.1s ease; }
                .kbd:hover { border-color: var(--up-accent); }
                .kbd:hover:not(.recording)::after { content: " (点击修改)"; font-size: 10px; opacity: 0.7; }
                .kbd.recording { color: white; background: var(--up-accent); border-color: var(--up-accent); animation: pulse 1.5s infinite; }
                .kbd.recording:hover { background: var(--up-accent); cursor: default; }
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.7; }
                    100% { opacity: 1; }
                }

                .top-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 6px;
                }
                .top-row svg {height:16px; width: 16px;}
                .top-row .title {
                    font-size: 14px;
                    font-weight: 700;
                    color: var(--text-title);
                    letter-spacing: -0.01em;
                }
                .dev-tag {
                    font-size: 11px;
                    background: #e7edf3;
                    color: var(--text-main);
                    padding: 2px 8px;
                    border-radius: 10px;
                    text-decoration: none;
                    transition: background-color 0.2s, color 0.2s;
                }

                .dev-tag:hover {
                    background: var(--up-accent);
                    color: white;
                }

                .desc {
                    font-size: 13px;
                    color: var(--text-main);
                    line-height: 1.3;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                    padding-right: 10px;
                }
                .card-body .title , .card-body .desc {
                    user-select: text;
                    -webkit-user-select: text;
                }
                .web-link a{
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--up-accent);
                    background: transparent;
                    transition: background-color 0.2s, color 0.2s;
                }
                .web-link a:hover {
                    background: var(--up-accent);
                    color: white;
                }
            `;
            this.shadow.appendChild(style);
        }

        _CommonRender() {
            // 面板结构
            const overlay = document.createElement('div');
            overlay.id = 'overlay';
            overlay.innerHTML = `
                <div id="modal">
                    <div class="nav" id="nav-bar"></div>
                    <div class="line"></div>
                    <div class="main" id="content"></div>
                    <div class="footer" id="footer"></div>
                </div>
            `;
            this.shadow.appendChild(overlay);
            this.overlay = overlay;
            this.navBar = this.shadow.getElementById('nav-bar');
            this.content = this.shadow.getElementById('content');
            this.footer = this.shadow.getElementById('footer');

            // 添加导航栏数据
            Object.keys(this.tabRegistry).forEach(key => {
                const btn = document.createElement('div');
                btn.className = `nav-item`;
                btn.dataset.tab = key;
                btn.innerHTML = this.tabRegistry[key].icon + this.tabRegistry[key].label;
                btn.onclick = () => this._switchTab(key);
                this.navBar.appendChild(btn);
            });
            // 主题切换按钮
            const theme_btn = document.createElement('div');
            theme_btn.className = "nav-theme";
            this.navBar.appendChild(theme_btn);

            // 导航栏关闭按钮
            const close_btn = document.createElement('div');
            close_btn.className = "nav-close";
            close_btn.innerText = "✕"
            this.navBar.appendChild(close_btn);

        }

        _switchTab(targetTab) {
            if (!this.navBar) return;

            let curTab = targetTab || this.data.activeTab || DEFAULT_CONFIG.activeTab;

            if (!this.tabRegistry[curTab]) {
                curTab = DEFAULT_CONFIG.activeTab;

                if (!this.tabRegistry[curTab]) {
                    console.error("[ControlPanel] 注册表中无任何可用标签页。");
                    return;
                }
            }

            if (typeof this._stopShortcutRecording === 'function') {
                this._stopShortcutRecording();
            }

            this.data.activeTab = curTab;

            this.navBar.querySelector('.nav-item.active')?.classList.remove('active');

            const targetSelector = `.nav-item[data-tab="${this.data.activeTab}"]`;
            this.navBar.querySelector(targetSelector)?.classList.add('active');

            const panels = this.content.querySelectorAll('.tab-panel-wrapper');
            panels.forEach(panel => {
                if (panel.dataset.tab === this.data.activeTab) {
                    panel.style.display = 'flex';
                    panel.style.opacity = '1';
                } else {
                    panel.style.display = 'none';
                    panel.style.opacity = '0';
                }
            });
        }
        _getBasicHTML() {
            if (!this.data.basic) this.data.basic = {};
            let b = this.data.basic;
            return `
                <!-- 勋章放大镜 -->
                <div class="card magnifier ${b?.medalMagnifier ? '' : 'disabled'}">
                    <div class="card-icon">${SVGControlPanel?.放大镜}</div>
                    <div class="card-info"><div class="card-title">勋章放大镜</div><div class="card-desc">鼠标移动到勋章时候，显示勋章的详细信息</div></div>
                    <label class="switch"><input type="checkbox" id="sw-medal" ${b?.medalMagnifier ? 'checked' : ''}><span class="slider"></span></label>
                </div>

                <!-- 定位模式 -->
                <div class="card positionMode ${b?.medalMagnifier ? '' : 'disabled'}">
                    <div class="card-icon">${SVGControlPanel?.定位}</div>
                    <div class="card-info"><div class="card-title">定位模式</div><div class="card-desc">勋章放大镜显示在勋章图片的 左侧/上下侧</div></div>
                    <div class="drop-selected win-btn" id="drop-pos"><span>${b?.positionMode === 'left' ? '左侧模式' : '上下模式'}</span>${SVGControlPanel?.下箭头}</div>
                </div>
                <div class="drop-list expandable ${b?.medalMagnifier ? '' : 'disabled'}">
                    <div class="drop-item" data-val="left">左侧模式</div>
                    <div class="drop-item" data-val="top-bottom">上下模式</div>
                </div>

                <!-- 显示图片 -->
                <div class="card showImage ${(b?.medalMagnifier && b?.showImage) ? '' : 'disabled'}">
                    <div class="card-icon">${SVGControlPanel?.图片}</div>
                    <div class="card-info">
                        <div class="card-title">显示图片</div>
                        <div class="card-desc">等级文字前显示对应的勋章图片</div>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="sw-img" ${b?.showImage ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>

                <!-- 聚合卡片容器 -->
                <div class="card card-group localImageMode ${b?.localImageMode ? 'is-open' : ''} ${(b?.medalMagnifier && b?.showImage && b?.localImageMode) ? '' : 'disabled'}">
                    <!-- 第一行：父元素 (本地图片模式) -->
                    <div class="card-item">
                        <div class="card-icon">${SVGControlPanel?.本地}</div>
                        <div class="card-info">
                            <div class="card-title">本地图片模式</div>
                            <div class="card-desc">自动保存图片到本地文件夹并从本地磁盘读取。此功能需要浏览器支持（Chrome、Edge ≥ 86，Firefox不支持）</div>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="sw-img-local" ${b?.localImageMode ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </div>

                    <!-- 子元素 (选择文件夹) -->
                    <div id="local-expand" class="select-dir expandable ${b?.localImageMode ? 'open' : ''} ${(b?.medalMagnifier && b?.showImage && b?.localImageMode) ? '' : 'disabled'} ">
                        <div class="card-item indent">
                            <div class="card-icon">${SVGControlPanel?.文件夹}</div>
                            <div class="card-info">
                                <div class="card-desc" style="margin-top:0">${this.handleName ? "已授权文件夹：" + this.handleName : "请选择一个本地文件夹"}</div>
                            </div>
                            <button class="win-btn" id="btn-select-dir">选择文件夹</button>
                        </div>
                    </div>
                </div>

                <!-- 数据库更新 -->
                <div class="card updateDb">
                    <div class="card-icon">${SVGControlPanel?.数据库}</div>
                    <div class="card-info">
                        <div class="card-title">手动更新数据库</div>
                        <div class="card-desc">自动更新的勋章数据异常时，手动同步脚本内置的数据到 IndexedDB，以便第三方脚本读取到最新的勋章数据</div>
                    </div>
                    <button class="win-btn" id="btn-db">更新</button>
                </div>

                <!-- 快捷键 -->
                <div class="card">
                    <div class="card-icon">${SVGControlPanel?.快捷键}</div>
                    <div class="card-info"><div class="card-title">快捷键</div><div class="card-desc">使用当前组合键可以快速开启放大镜的设置面板</div></div>
                    <div class="kbd win-btn">${b?.shortcut || "Alt + S"}</div>
                </div>
            `;
        }

        _bindBasicEvents() {
            const isLocalImgEnabled = typeof window.showDirectoryPicker === 'function';
            const magnifierCard = this.shadow.querySelector('.magnifier');
            const magnifierSwitch = magnifierCard.querySelector('input[type="checkbox"]');

            const dropCard = this.shadow.querySelector('.positionMode');
            const dropBtn = this.shadow.querySelector('#drop-pos');
            const dropList = this.shadow.querySelector('.drop-list');
            const dropListItems = dropList.querySelectorAll('.drop-item');

            const imageCard = this.shadow.querySelector('.showImage');
            const imageSwitch = imageCard.querySelector('input[type="checkbox"]');

            const imageLocalCard = this.shadow.querySelector('.localImageMode');
            const imageLocalSwitch = imageLocalCard.querySelector('input[type="checkbox"]');

            const selectDirCard = this.shadow.querySelector('.select-dir')
            const selectDirBtn = selectDirCard.querySelector('button');

            const dbUpdateBtn = this.shadow.getElementById('btn-db')

            const kbdBtn = this.shadow.querySelector('.kbd');

            // 放大镜点击事件
            magnifierSwitch.onchange = (e) => {
                const checked = e.target.checked
                this.data.basic.medalMagnifier = checked

                magnifierCard.classList.toggle('disabled', !checked);
                dropCard.classList.toggle('disabled', !checked);
                dropListItems.forEach(item => { item.classList.toggle('disabled', !checked); })

                const isimageSwitchChecked = imageSwitch.checked
                imageCard.classList.toggle('disabled', !(checked && isimageSwitchChecked));

                if (isLocalImgEnabled) {
                    const isimageLocalSwitchChecked = imageLocalSwitch.checked
                    imageLocalCard.classList.toggle('disabled', !(checked && isimageLocalSwitchChecked));
                    selectDirCard.classList.toggle('disabled', !(checked && isimageLocalSwitchChecked));
                }

                this._saveData();
                this.toast.show({ type: (checked ? "success" : "warning"), msg: '勋章放大镜镜' + (checked ? '开启' : '关闭') });
            };

            // 定位模式：下拉逻辑
            dropBtn.onclick = (e) => {

                const rect = dropBtn.getBoundingClientRect();
                const containerRect = this.shadow.getElementById('modal').getBoundingClientRect();

                dropList.style.top = `${rect.bottom - containerRect.top + 5}px`;
                dropList.style.left = `${rect.left - containerRect.left}px`;
                dropList.style.width = `${rect.width}px`;

                const isOpen = dropList.classList.contains('open');
                dropList.classList.toggle('open', !isOpen);
                e.stopPropagation();
            };
            dropListItems.forEach(item => {
                item.onclick = () => {
                    const isMagnifierOpen = magnifierSwitch.checked

                    const val = item.dataset.val;
                    const oldSelect = dropBtn.querySelector('span').innerText
                    if (oldSelect !== item.innerText) {
                        dropBtn.querySelector('span').innerText = item.innerText;
                        this.data.basic.positionMode = val;
                        this._saveData();
                        this.toast.show({ type: "success", msg: "定位模式已成功切换到：" + item.innerText });
                    } else {
                        this.toast.show({ type: "info", msg: "当前定位模式已经是：" + item.innerText });
                    }
                    if (!isMagnifierOpen) this.toast.show({ type: "error", msg: "定位模式未生效，请先开启勋章放大镜镜！" })

                };
            });
            document.addEventListener('scroll', () => dropList.classList.remove('open'));
            document.addEventListener('click', () => dropList.classList.remove('open'));

            // 显示图片点击事件
            imageSwitch.onchange = (e) => {
                const isMagnifierOpen = magnifierSwitch.checked
                const isImageLocalChecked = imageLocalSwitch.checked

                const checked = e.target.checked
                this.data.basic.showImage = checked

                imageCard.classList.toggle('disabled', !(isMagnifierOpen && checked));
                isLocalImgEnabled && imageLocalCard.classList.toggle('disabled', !(isMagnifierOpen && isImageLocalChecked && checked));
                isLocalImgEnabled && selectDirCard.classList.toggle('disabled', !(isMagnifierOpen && isImageLocalChecked && checked));

                this._saveData();
                this.toast.show({ type: (checked ? "success" : "info"), msg: '显示图片已' + (checked ? '开启' : '关闭') });
                if (!isMagnifierOpen && checked) this.toast.show({ type: "error", msg: "无法显示图片，请先开启勋章放大镜镜！" })
            }
            if (!isLocalImgEnabled) {
                imageLocalCard.style.display = 'none'
            }
            // 本地图片模式点击事件
            imageLocalSwitch.onchange = (e) => {
                const isMagnifierOpen = magnifierSwitch.checked
                const isimageSwitchChecked = imageSwitch.checked

                const errors = [];
                if (!isMagnifierOpen) errors.push("勋章放大镜");
                if (!isimageSwitchChecked) errors.push("显示图片");

                const checked = e.target.checked

                selectDirCard.classList.toggle('open', checked);
                imageLocalCard.classList.toggle('is-open', checked);

                imageLocalCard.classList.toggle('disabled', !(isMagnifierOpen && isimageSwitchChecked && checked));
                selectDirCard.classList.toggle('disabled', !(isMagnifierOpen && isimageSwitchChecked && checked));

                this.data.basic.localImageMode = checked
                this._saveData();
                this.toast.show({ type: (checked ? "success" : "info"), msg: '本地图片模式已' + (checked ? '开启' : '关闭') });
                if (errors.length > 0 && checked) {
                    const errorMsg = errors.join(" 和 ");
                    this.toast.show({ type: "error", msg: `无法显示本地图片，请先开启：${errorMsg}！` })
                }
            }
            // 本地文件夹授权
            selectDirBtn.onclick = async () => {
                const isMagnifierOpen = magnifierSwitch.checked
                const isimageSwitchChecked = imageSwitch.checked
                const errors = [];
                if (!isMagnifierOpen) errors.push("勋章放大镜");
                if (!isimageSwitchChecked) errors.push("显示图片");


                try {
                    if (await this.localFile.authorize()) {
                        const name = await this.localFile.getHandleName()
                        selectDirCard.querySelector('.card-desc').textContent = '已授权文件夹：' + name;
                        this.toast.show({ type: 'success', msg: `已授权文件夹：${name}` });
                    }
                    else this.toast.show({ type: 'error', msg: "授权被取消或失败！" });

                } catch (err) {
                    console.log(err)
                    this.toast.show({ type: 'error', msg: "无法授权，授权异常！" });
                }

                if (errors.length > 0) {
                    const errorMsg = errors.join(" 和 ");
                    this.toast.show({ type: "error", msg: `无法显示本地图片，请先开启：${errorMsg}！` })
                }
            };

            // 数据库更新
            dbUpdateBtn.onclick = async () => {
                this.toast.show({ type: "info", msg: 'IndexedDB数据库开始更新……' });
                await this.updateFn?.();
                this.toast.show({ type: "success", msg: 'IndexedDB数据库更新成功！' });

            };

            // 快捷键
            this.isRecording = false;
            const capture = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (e.key === 'Escape') {
                    kbdBtn.textContent = this.data.basic.shortcut || "Alt + S";
                    kbdBtn.classList.remove('recording');
                    this.isRecording = false;
                    window.removeEventListener('keydown', capture, true);
                    return;
                }

                // 过滤掉单纯的修饰键
                if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

                // 构造组合键字符串
                const keys = [];
                if (e.ctrlKey) keys.push('Ctrl');
                if (e.altKey) keys.push('Alt');
                if (e.shiftKey) keys.push('Shift');

                // 首字母大写处理
                const mainKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
                keys.push(mainKey);

                const newShortcut = keys.join(' + ');

                // 保存数据
                this.data.basic.shortcut = newShortcut;
                this._saveData();

                // 更新界面
                kbdBtn.textContent = newShortcut;
                kbdBtn.classList.remove('recording');
                this.isRecording = false;

                // 移除监听
                window.removeEventListener('keydown', capture, true);
                this.toast.show({ type: 'success', msg: `快捷键已修改为: ${newShortcut}` });
            };
            const stopRecording = () => {
                if (!this.isRecording) return;
                this.isRecording = false;
                kbdBtn.classList.remove('recording');
                // 恢复原始文字显示
                kbdBtn.textContent = this.data.basic.shortcut || "Alt + S";
                window.removeEventListener('keydown', capture, true);
                this.toast.show({ type: 'info', msg: `快捷键修改已退出，当前为: ${this.data.basic.shortcut || "Alt + S"}` });
                this._stopShortcutRecording = null
            };
            kbdBtn.onclick = () => {
                if (this.isRecording) return;
                this.isRecording = true;
                kbdBtn.classList.add('recording');
                kbdBtn.textContent = "请按下按键...";

                this._stopShortcutRecording = stopRecording;

                window.addEventListener('keydown', capture, true);
            };

        }
        _getWeightHTML() {
            const weightEntries = Object.entries(this.data.weights).map(([k, v]) => {
                return `
                    <div class="row ${v.enabled ? '' : 'disabled'}" data-key="${k}">
                        ${(typeof SVG !== 'undefined' && SVG[k]) ? SVG[k] : ''}
                        <div class="row-label">${k}</div>
                        <div class="row-controls">
                            <button class="ste-btn" data-op="-1">-</button>
                            <input type="number" name="input-num" class="input-num" value="${v.value}">
                            <button class="ste-btn" data-op="1">+</button>
                            <label class="switch">
                                <input type="checkbox" name="weight-switch" class="weight-switch" ${v.enabled ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                    `;
            }).join('');

            return `
                    ${weightEntries}
                    <div class="tab-footer">
                        <button class="btn btn-reset" id="act-reset">重置权重</button>
                    </div>

            `;
        }

        // 绑定交互逻辑
        _bindWeightEvents() {

            const rows = this.shadow.querySelectorAll('.row');

            rows.forEach(row => {
                const k = row.dataset.key;
                const input = row.querySelector('.input-num');
                const checkbox = row.querySelector('.weight-switch');

                // 加减按钮逻辑
                row.querySelectorAll('.ste-btn').forEach(btn => {
                    btn.onclick = () => {
                        const op = parseInt(btn.dataset.op);
                        const currentVal = parseInt(input.value) || 0;
                        input.value = currentVal + op;
                        this.data.weights[k] = { value: input.value, enabled: checkbox.checked };
                    };
                });
                input.onchange = () => {
                    const currentVal = parseInt(input.value) || 0;
                    this.data.weights[k] = { value: currentVal, enabled: checkbox.checked };
                };
                // 开关切换样式同步
                checkbox.onchange = (e) => {
                    this.data.weights[k] = { value: input.value, enabled: checkbox.checked };
                    row.classList.toggle('disabled', !e.target.checked);
                };
            });

            // 重置按钮
            this.shadow.getElementById('act-reset').onclick = () => {

                const resetWeights = JSON.parse(JSON.stringify(DEFAULT_CONFIG.weights));

                Object.keys(resetWeights).forEach(k => {

                    const row = this.shadow.querySelector(`.row[data-key="${k}"]`);
                    if (row) {
                        const checkbox = row.querySelector('.weight-switch');
                        const input = row.querySelector('.input-num');
                        const isEnabled = resetWeights[k].enabled;

                        checkbox.checked = isEnabled;
                        input.value = resetWeights[k].value;

                        if (isEnabled) {
                            row.classList.remove('disabled');
                        } else {
                            row.classList.add('disabled');
                        }
                    }
                });
                this.toast.show({
                    type: 'warning',
                    msg: '权重数值已重置，请点击保存生效！'
                });


            };
        }
        static forumSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z" fill="none"/><path fill="currentColor" d="M5.5 5a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1zm0 2.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1zm0 2.5a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1zm-1-8A2.5 2.5 0 0 0 2 4.5v7A2.5 2.5 0 0 0 4.5 14h7a2.5 2.5 0 0 0 2.5-2.5v-7A2.5 2.5 0 0 0 11.5 2zM3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5z"/></svg>`;
        static forumData = [
            {
                title: "勋章放大镜",
                developer: "轶致",
                desc: "勋章放大镜的原始版本，已不在更新。",
                developerlink: "https://www.gamemale.com/space-uid-730592.html",
                weblink: "https://www.gamemale.com/thread-129944-1-1.html",
            },
            {
                title: "勋章放大镜",
                developer: "咸鱼鱼",
                desc: "基于轶致勋章放大镜，由咸鱼鱼维护更新勋章数据。",
                developerlink: "https://www.gamemale.com/space-uid-723150.html",
                weblink: "https://www.gamemale.com/thread-147865-1-1.html",
            },
            {
                title: "勋章放大镜-暗黑版",
                developer: "哈哈哈哈_",
                desc: "基于咸鱼鱼的勋章数据，勋章放大镜重构版本。优化样式、本地存储图片、idb公共数据、控制面板……",
                developerlink: "https://www.gamemale.com/space-uid-712448.html",
                weblink: "https://www.gamemale.com/thread-188040-1-1.html",
            },
        ];
        static linkData = [
            {
                title: "勋章补货记录-表格版",
                developer: "咸鱼鱼",
                desc: "从2024年中秋节开始，记录了每次补货的勋章数据，还可以进行补货预测。同时开放了api接口可供调用。",
                developerlink: "https://www.gamemale.com/space-uid-723150.html",
                weblink: "https://badge.saltfish.cc.cd/",
                icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path fill="currentColor" d="M11 16H3v3q0 .825.588 1.413T5 21h6zm2 0v5h6q.825 0 1.413-.587T21 19v-3zm-2-2V9H3v5zm2 0h8V9h-8zM3 7h18V5q0-.825-.587-1.412T19 3H5q-.825 0-1.412.588T3 5z"/></svg>`,
            },
            {
                title: "勋章补货日志-美化版",
                developer: "hezhushizaishi",
                desc: "基于咸鱼鱼的勋章补货数据，Claude实现的勋章补货日志前端，兼顾美观性，可读性和未来数据兼容性。",
                developerlink: "https://www.gamemale.com/space-uid-736317.html",
                weblink: "https://restock-log.pages.dev/",
                icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path fill="#fdb66d" d="M14.4 3.419a.639.639 0 0 1 1.2 0l.61 1.668a9.59 9.59 0 0 0 5.703 5.703l1.668.61a.639.639 0 0 1 0 1.2l-1.668.61a9.59 9.59 0 0 0-5.703 5.703l-.61 1.668a.639.639 0 0 1-1.2 0l-.61-1.668a9.59 9.59 0 0 0-5.703-5.703l-1.668-.61a.639.639 0 0 1 0-1.2l1.668-.61a9.59 9.59 0 0 0 5.703-5.703zM8 16.675a.266.266 0 0 1 .5 0l.254.694a4 4 0 0 0 2.376 2.377l.695.254a.266.266 0 0 1 0 .5l-.695.254a4 4 0 0 0-2.376 2.377l-.254.694a.266.266 0 0 1-.5 0l-.254-.694a4 4 0 0 0-2.376-2.377l-.695-.254a.266.266 0 0 1 0-.5l.695-.254a4 4 0 0 0 2.376-2.377zM4.2.21a.32.32 0 0 1 .6 0l.305.833a4.8 4.8 0 0 0 2.852 2.852l.833.305a.32.32 0 0 1 0 .6l-.833.305a4.8 4.8 0 0 0-2.852 2.852L4.8 8.79a.32.32 0 0 1-.6 0l-.305-.833a4.8 4.8 0 0 0-2.852-2.852L.21 4.8a.32.32 0 0 1 0-.6l.833-.305a4.8 4.8 0 0 0 2.852-2.852z"/></svg>`,
            },
            {
                title: "勋章博物馆",
                developer: "hezhushizaishi",
                desc: "勋章收益可视化，包含各个榜单，说明面板，勋章鉴定室……",
                developerlink: "https://www.gamemale.com/space-uid-736317.html",
                weblink: "https://medal-museum.pages.dev/",
                icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 14 14"><path d="M0 0h14v14H0z" fill="none"/><g fill="none" fill-rule="evenodd" clip-rule="evenodd"><path fill="#2859c5" d="M10.284 5.934v5.054h2.664V5.933l-.038.001zm-4.616 0v5.054h2.664V5.934zm-4.616-.001v5.055h2.664V5.934H1.052Z"/><path fill="#8fbffa" d="M6.386.233a1.21 1.21 0 0 1 1.248.013l5.911 3.87c.42.277.547.754.385 1.161c-.156.392-.55.657-1.02.657H1.09c-.47 0-.864-.265-1.02-.657c-.162-.407-.034-.884.385-1.16l.001-.001l5.91-3.87zM0 11.877c0-.6.572-.889 1-.889h12c.428 0 1 .289 1 .89v1.167c0 .6-.572.889-1 .889H1c-.428 0-1-.289-1-.89z"/></g></svg>`,
            }
        ];
        _getAboutHTML() {
            return ControlPanel.forumData.map(item => `
                <div class="card">
                    <div class="card-body">
                        <div class="top-row">
                            ${ControlPanel.forumSvg}
                            <span class="title">${item.title}</span>
                            <a href="${item.developerlink}" target="_blank"  class="dev-tag">@${item.developer}</a>
                        </div>
                        <div class="desc">${item.desc}</div>
                    </div>
                    <div class="web-link">
                        <a href="${item.weblink}" target="_blank" class="visit-btn">${SVGControlPanel?.链接}</a>
                    </div>
                </div>
            `).join('') + `<div style="padding-left: 16px; line-height: 1;">第三方网站</div>` + ControlPanel.linkData.map(item => `
                <div class="card">
                    <div class="card-body">
                        <div class="top-row">
                            ${item?.icon || SVGControlPanel?.网站}
                            <span class="title">${item.title}</span>
                            <a href="${item.developerlink}" target="_blank"  class="dev-tag">@${item.developer}</a>
                        </div>
                        <div class="desc">${item.desc}</div>
                    </div>
                    <div class="web-link">
                        <a href="${item.weblink}" target="_blank" class="visit-btn">${SVGControlPanel?.链接}</a>
                    </div>
                </div>
            `).join('');
        }

        _BindCommonEvents() {
            const navThemeEl = this.shadow.querySelector('.nav-theme');
            navThemeEl.innerHTML = `${SVGControlPanel[this.data.theme.magnifierTheme]}`;
            navThemeEl.onclick = () => {
                const nextTheme = this.data.theme.magnifierTheme === 'light' ? 'dark' : 'light';
                this.data.theme.magnifierTheme = nextTheme;
                navThemeEl.innerHTML = `${SVGControlPanel[this.data.theme.magnifierTheme]}`;
                this.toast.show({
                    type: 'success',
                    msg: `放大镜主题已成功切换到：${nextTheme}！`
                });
            }

            this.shadow.querySelector('.nav-close').onclick = () => this.hide();

            this.overlay.onclick = (e) => { if (e.target === this.overlay) this.hide(); };

            window.addEventListener('keydown', (e) => {
                const activeEl = document.activeElement;
                const isInput = activeEl.tagName === 'INPUT' ||
                    activeEl.tagName === 'TEXTAREA' ||
                    activeEl.isContentEditable;
                if (isInput) return;

                if (e.key === 'Escape') {
                    this.hide();
                    return;
                }

                // 解析当前保存的快捷键
                const currentShortcut = this.data.basic.shortcut || "Alt + S";
                const parts = currentShortcut.toLowerCase().split(' + ');

                const needsCtrl = parts.includes('ctrl');
                const needsAlt = parts.includes('alt');
                const needsShift = parts.includes('shift');
                const mainKey = parts[parts.length - 1];

                const match =
                    e.ctrlKey === needsCtrl &&
                    e.altKey === needsAlt &&
                    e.shiftKey === needsShift &&
                    e.key.toLowerCase() === mainKey;

                if (match) {
                    e.preventDefault();
                    this.isHide ? this.show() : this.hide();
                }
            });
        }

        /** 显示控制面板 */
        show() {
            this.isHide = false
            this._switchTab();
            this.overlay.style.display = 'flex';
            setTimeout(() => {
                this.overlay.style.opacity = '1';
                this.shadow.getElementById('modal').style.transform = 'translateY(0)';
            }, 10);
        }

        /** 隐藏控制面板 */
        hide() {
            if (typeof this._stopShortcutRecording === 'function') {
                this._stopShortcutRecording();
            }

            this.isHide = true

            if (JSON.stringify(this.data) !== JSON.stringify(JSON.parse(localStorage.getItem(this.storageKey)))) this._saveData();
            this.overlay.style.opacity = '0';
            this.shadow.getElementById('modal').style.transform = 'translateY(20px)';
            setTimeout(() => this.overlay.style.display = 'none', 300);
        }
        /**
         * 获取整个基础参数
         * @returns {keyof (typeof DEFAULT_CONFIG)['basic']} 返回基础参数
         */
        getBasicObj() {
            return this.data.basic
        }
        /**
         * 获取主题
         * @returns {keyof (typeof DEFAULT_CONFIG)['theme']} 返回主题
         */
        getTheme() {
            return this.data.theme.magnifierTheme || 'light';
        }
        /**
         * 获取基础参数的值
         * @param {keyof (typeof DEFAULT_CONFIG)['basic']} key 基础参数名
         * @returns {boolean|string} 基础参数的值
         */
        getBasicByKey(key) {
            return this.data.basic?.[key]
        }
        /**
         * 权重参数是否启用，获取权重参数的enabled值
         * @param {keyof (typeof DEFAULT_CONFIG)['weights']} key 权重属性名
         * @returns {boolean} 是否启用，不存在的参数返回false
         */
        getWeightEnable(key) {
            return this.data.weights?.[key]?.enabled ?? false;
        }
        /**
         * 获取权重参数的值
         * @param {keyof (typeof DEFAULT_CONFIG)['weights']} key 权重属性名
         * @returns {number} 权重值，若未启用或不存在则返回 0
         */
        getWeight(key) {
            const item = this.data.weights?.[key];
            if (!item?.enabled) return 0;
            return item?.value ?? 0;

        }
        /**
         * 更新按钮的传入方法
         * @param {function} fn 传入的方法
         */
        addUpdateFunc(fn) {
            this.updateFn = fn;
        }
    }

    /**
    * 工具函数
    * @param {} managerInstance - 权重管理面板实例
    */
    const util = (managerRef) => {
        /**
         * 安全地将其他类型转换为有效的数字，转换失败时候默认为0
         * @param {*} v - 需要转换的原始值
         * @param {number} [def=0] - 转换失败时的默认备用值，默认为0
         * @returns {number} 转换后的有效数字
         */
        const toNumber = (v, def = 0) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : def;
        }
        /**
         * 获取WEIGHT_MAP的权重值
         * @param {keyof (typeof DEFAULT_CONFIG)['weights']} k 权重
         * @returns {number} 权重值
         */
        const getWeight = (k) => {
            const instance = managerRef.instance;
            if (!instance) throw new Error("Manager 尚未实例化！");
            return instance.getWeight(k);
        }
        /**
         * 获取WEIGHT_MAP的Enable值
         * @param {keyof (typeof DEFAULT_CONFIG)['weights']} k 权重
         * @returns {boolean} 权重是否启用
         */
        const getWeightEnable = (k) => {
            const instance = managerRef.instance;
            if (!instance) throw new Error("Manager 尚未实例化！");
            return instance.getWeightEnable(k);
        }
        /**
         * 正数前面显示 +
         */
        const formatAward = (k, v) => `${k}${v >= 0 ? '+' : ''}${v}`
        /**
        * 升级消耗计算后 加上ATTR_MAP颜色、格式化（血液<100 50<血液<200）
        */
        const formatUpgradeRange = ({ lower, upper }, key) => {
            const color = ATTR_MAP?.[key]?.color || '';
            if (upper) {
                const leftOp = /[=≥]/.test(lower.op) ? '≤' : '<';
                const rightOp = /[=≥]/.test(upper.op) ? '<' : '≤';
                return `<span style="color:${color}">${lower.val}${leftOp}${key}${rightOp}${upper.val}</span>`;
            }

            return `<span style="color:${color}">${key}${lower.op}${lower.val}</span>`;
        }
        /**
        * 名称只保留数字、中文、英文、『』
        */
        const name_cleansing = (str) => str.replace(/[^a-zA-Z0-9『』\p{Unified_Ideograph}]/gu, '')
        /**
         * 名称模糊查询变体（去重）
         */
        const name_variants = (str) => {
            return new Set([
                str,
                name_cleansing(str),
                str.replace(/【.*?限定】/g, ''),
            ])
        }
        /**
         * 判读对象的类型
         * @param {*} obj
         * @returns String || Array || Other
         */
        const objType = (obj) => {
            const type = Object.prototype.toString.call(obj);

            if (type === '[object String]') {
                return "String"
            } else if (type === '[object Array]') {
                return "Array"
            }
            return "Other"
        }
        /**
         * 从URL中获取文件名
         * @param {string} url
         * @returns {string} 文件名
         */
        const getFileNameFromUrl = (url) => {
            try {
                // 使用 URL 类解析，自动过滤 QueryString (?v=1) 和 Hash (#anchor)
                const urlObj = new URL(url);
                const pathName = urlObj.pathname;

                // 提取最后一段作为文件名
                let fileName = pathName.substring(pathName.lastIndexOf('/') + 1);

                // 如果 URL 以 / 结尾或没有文件名，给定默认名称
                if (!fileName) {
                    fileName = "downloaded_file_" + Date.now();
                }

                // 清洗 Windows/Linux 不允许的非法字符
                // 字符范围: \ / : * ? " < > |
                const cleanName = fileName.replace(/[\\/:*?"<>|]/g, '_');

                // 解码 URL 编码字符 (例如 %20 转为空格)
                return decodeURIComponent(cleanName).substring(0, 255);
            } catch (e) {
                return "fallback_" + Date.now();
            }
        }
        return {
            toNumber,
            getWeight,
            getWeightEnable,
            formatAward,
            formatUpgradeRange,
            name_cleansing,
            name_variants,
            objType,
            getFileNameFromUrl,
        }
    }

    /**
    * 勋章等级数据解析计算工具：用于解析论坛勋章的等级、属性、升级条件，并计算回本周期和收益
    * @param {ReturnType<typeof util>} utilInstance 工具函数实例 util
    */
    const createConvertLEVELS = (utilInstance) => {
        // ---  正则缓存 (避免重复编译正则) ---
        const RE_PRICE = /^(\d+)(金币|血液|旅程|堕落|灵魂|咒术|知识)$/;
        const RE_RATE = /(\d+)%/;
        const RE_REPLY = /回帖([\s\S]*?)(?=发帖|▕▏|$)/;
        const RE_POST = /发帖([\s\S]*?)(?=▕▏|$)/;
        const RE_BLOCK_ATTR = /([^\s+\-、]+)([+\-]\d+)/g;
        const RE_LINE_HEAD = /【\s*(?:等级\s*)?(\d+|Max|初级)\s*】(.+)/i;
        const RE_UPGRADE_HEAD = /升级条件[:：]\s*(.+)$/;
        const RE_COST_1 = /消耗\s*([-－]?\d+)\s*([^\d\s-－]+)/;
        const RE_COST_2 = /消耗\s*([^\d\s-－]+)\s*([-－]?\d+)/;
        const RE_COND_1 = /^([≥>≤<＜=]{1,2})\s*(\d+)\s*([^\d\s≥>≤<=]+)/;
        const RE_COND_2 = /^([^\d\s≥>≤<=]+)\s*([≥>≤<＜=]{1,2})\s*(\d+)/;


        /* ---------------- 基础解析工具 (parse) ---------------- */
        const parse = {
            /**
             * 解析购买价格字符串为数值
             */
            BuyPrice: (buy_price) => {
                if (!buy_price) return 0;
                const str = buy_price.toString();
                const m = str.match(RE_PRICE);
                return m ? utilInstance.toNumber(m[1]) * utilInstance.getWeight(m[2]) : (parseInt(buy_price, 10) || 0);
            },

            /**
             * 解析概率百分比
             */
            Rate: (s = '') => {
                const m = s.match(RE_RATE);
                return m ? utilInstance.toNumber(m[1]) / 100 : 0;
            },

            /**
             * 解析回帖/发帖的属性加成
             */
            Effects: (text = '') => {
                const result = { replay: {}, post: {}, other: '' };
                if (!text) return result;

                const effectPart = text.split('升级条件')[0];
                const replayMatch = effectPart.match(RE_REPLY);
                const postMatch = effectPart.match(RE_POST);

                if (!replayMatch && !postMatch) {
                    result.other = effectPart.split('▕▏')[0];
                }

                const parseBlock = (block, target) => {
                    if (!block) return;
                    let m;
                    while ((m = RE_BLOCK_ATTR.exec(block))) {
                        target[m[1]] = utilInstance.toNumber(m[2]);
                    }
                };

                parseBlock(replayMatch?.[1], result.replay);
                parseBlock(postMatch?.[1], result.post);
                return result;
            },

            /**
             * 解析单行升级条件字符串
             */
            Upgrade: (line = '') => {
                const mHead = line.match(RE_UPGRADE_HEAD);
                if (!mHead) return null;

                const expr = mHead[1];
                let m;

                // 匹配：消耗 10 金币 或 消耗 金币 10
                if (
                    (m = expr.match(RE_COST_1)) ||
                    (m = expr.match(RE_COST_2))
                ) {
                    const cost = m[1].match(/[-－]?\d+/) ? m[1] : m[2];
                    const item = m[1].match(/[-－]?\d+/) ? m[2] : m[1];
                    return {
                        type: '消耗',
                        cost: utilInstance.toNumber(cost.replace('－', '-')),
                        item
                    };
                }

                // 匹配：属性 >= 100
                if (
                    (m = expr.match(RE_COND_1)) ||
                    (m = expr.match(RE_COND_2))
                ) {
                    const isStatFirst = isNaN(parseFloat(m[1]));
                    return {
                        type: '条件',
                        stat: isStatFirst ? m[1] : m[3],
                        operator: isStatFirst ? m[2] : m[1],
                        value: utilInstance.toNumber(isStatFirst ? m[3] : m[2])
                    };
                }
                return expr;
            },

            /**
             * 将原始等级文本块解析为结构化对象
             */
            Levels: (levelsStr = '') => {
                const str = String(levelsStr || '');
                return Object.fromEntries(
                    str.split('\n')
                        .map(s => s.trim())
                        .filter(Boolean)
                        .map(line => {
                            const m = line.match(RE_LINE_HEAD);
                            if (!m) return null;

                            const k = m[1];
                            const v = m[2].trim();
                            const effects = parse.Effects(v);

                            return [k, {
                                rate: parse.Rate(v),
                                post: effects.post,
                                replay: effects.replay,
                                other: effects.other,
                                upgrade: k === 'Max' ? null : parse.Upgrade(v)
                            }];
                        })
                        .filter(Boolean)
                );
            }
        };

        /* ---------------- 核心计算逻辑 (compute) ---------------- */
        const compute = {
            /**
             * 计算每个等级的消耗、累积消耗和维持条件
             */
            UpgradeCost: (levelsObj) => {
                let consumedItems = {};
                let consumedTotal = 0;
                let requirementStats = {};
                const result = {};
                const maxOps = ['>', '>=', '≥'];

                for (const lvl of Object.keys(levelsObj)) {
                    const { upgrade } = levelsObj[lvl];
                    const range = {};

                    // 复制当前的维持条件
                    for (const [k, v] of Object.entries(requirementStats)) {
                        range[k] = { lower: v, upper: null };
                    }

                    // 处理当前等级的属性阈值
                    if (upgrade?.stat && maxOps.includes(upgrade.operator)) {
                        range[upgrade.stat] ??= { lower: { op: '≥', val: 0 }, upper: null };
                        range[upgrade.stat].upper = { op: upgrade.operator, val: upgrade.value };
                    }

                    result[lvl] = {
                        消耗: { ...consumedItems },
                        总消耗: consumedTotal,
                        条件: range
                    };

                    if (!upgrade) continue;

                    if (upgrade.type === '消耗') {
                        consumedItems[upgrade.item] = (consumedItems[upgrade.item] ?? 0) + upgrade.cost;
                        consumedTotal += upgrade.cost * utilInstance.getWeight(upgrade.item);
                        requirementStats = {}; // 消耗型升级通常重置之前的属性维持条件
                    } else if (upgrade.stat && maxOps.includes(upgrade.operator)) {
                        const cur = requirementStats[upgrade.stat];
                        if (!cur || upgrade.value > cur.val) {
                            requirementStats[upgrade.stat] = { op: upgrade.operator, val: upgrade.value };
                        }
                    }
                }
                return result;
            },
        };

        /* ---------------- HTML 转换逻辑 (toHtml) ---------------- */
        const toHtml = {
            /**
             * 转换为收益浮点数 HTML 标签，并找出最大收益等级
             */
            LevelsFloat: (levelsObj, type = "replay") => {
                let BeatLv = { value: -Infinity, level: "1" };
                let MaxLv = 0;

                const map = {};

                for (const k in levelsObj) {
                    if (!Object.hasOwn(levelsObj, k)) continue;

                    const v = levelsObj[k];
                    const stats = type === "replay" ? v.replay : v.post;
                    const rate = v.rate ?? 0;

                    let total = 0;
                    let itemsHtml = '';

                    if (stats) {
                        for (const key in stats) {
                            if (!Object.hasOwn(stats, key)) continue;

                            if (!utilInstance.getWeightEnable(key)) continue;

                            const val = stats[key];
                            const value = val * rate * utilInstance.getWeight(key);
                            total += value;

                            const emoji = ATTR_MAP?.[key]?.emoji || '';
                            itemsHtml += `${emoji}${value.toFixed(2)}`;
                        }
                    }

                    const totalFixed = total.toFixed(2);

                    if (total >= parseFloat(BeatLv.value)) {
                        BeatLv = { value: totalFixed, level: k };
                    }
                    if (k.toLowerCase() == 'max') MaxLv = totalFixed;

                    const totalEmoji = ATTR_MAP?.['总计']?.emoji || '';
                    map[k] = `<span class="medal-floats item">${itemsHtml}</span><span class="medal-floats total">${totalEmoji}${totalFixed}</span>`;
                }
                if (BeatLv.value === -Infinity) {
                    BeatLv.value = "0.00";
                }

                return { map, BeatLv, MaxLv };
            },

            /**
             * 转换等级Object{level, 原始文本} 为 {level, HTML}
             */
            LevelsRaw: (levelsObj) => {
                return Object.fromEntries(
                    Object.entries(levelsObj).map(([k, v]) => {
                        const { rate, post, replay, upgrade, other } = v;
                        const rateHTML = rate ? `<span class="medal-rate">${parseInt(rate * 100)}%</span>` : '<span class="medal-rate">0%</span>';
                        const replayHTML = replay && Object.keys(replay).length ? `<span class="medal-replay">回帖${Object.entries(replay).map(([rk, rv]) => utilInstance.formatAward(rk, rv)).join(' ')}</span>` : '';
                        const postHTML = post && Object.keys(post).length ? `<span class="medal-post">发帖${Object.entries(post).map(([pk, pv]) => utilInstance.formatAward(pk, pv)).join(' ')}</span>` : '';

                        const upStr = upgrade
                            ? typeof upgrade === 'string'
                                ? upgrade
                                : upgrade.type === '消耗'
                                    ? `消耗${upgrade.cost}${upgrade.item}`
                                    : `${upgrade.stat}${upgrade.operator}${upgrade.value}`
                            : '';

                        return [k,
                            `${rateHTML}<div class="medal-raw">${other ? `<span class="medal-other">${other}</span>` : ''}${replayHTML}${postHTML}${upStr ? `<span class="medal-upgrade">升级条件：${upStr}</span>` : ''}</div>`
                        ];
                    })
                );
            },

            /**
             * 渲染等级图标
             */
            Imgs: (imgsObj) => {
                if (!imgsObj) return {};
                const result = {};
                for (const key in imgsObj) {
                    if (Object.hasOwn(imgsObj, key)) {
                        const [src, width] = imgsObj[key];

                        result[key] = src
                            ? `<div class="level-img"><img src="${src}" width="${width}" loading="lazy"></div>`
                            : `<div class="level-img none">${SVG?.["缺图"] || ''}</div>`;
                    }
                }
                return result;
            },

            /**
             * 渲染升级成本及回本周期 HTML
             */
            CostInfo: (levelsObj, buy_price, BeatLv, MaxLv) => {
                const costData = compute.UpgradeCost(levelsObj);
                const buyPriceValue = parse.BuyPrice(buy_price);

                const renderLvl = (lvl, award, isMaxHeader = false) => {
                    const data = costData[lvl] || {};
                    const consumes = data.消耗 || {};
                    const conds = data.条件 || {};

                    const costHtml = Object.entries(consumes)
                        .map(([k, v]) => `<span style="color:${ATTR_MAP?.[k]?.color || ''}">${v}${k}</span>`)
                        .join('、');

                    const condHtml = Object.entries(conds)
                        .map(([k, v]) => utilInstance.formatUpgradeRange(v, k))
                        .join('、');

                    const awardNum = utilInstance.toNumber(award);

                    const getPeriod = (base) => awardNum > 0 ? `${Math.floor(base / awardNum)}贴` : '无法计算';

                    const title = isMaxHeader
                        ? `【 Max 】回帖收益（<span style="color:#ff4b4b;">${award}</span>）${BeatLv.level === lvl ? '最大' : ''}`
                        : `【等级${lvl}】回帖收益（<span style="color:#ff4b4b;">${award}</span>）${BeatLv.level === lvl ? '最大' : ''}`;

                    return `<div style="margin-bottom:4px;">
                    <div>${title}${costHtml ? `，升级消耗（${costHtml}）` : ''}${condHtml ? `，维持 ${condHtml}` : ''}</div>
                    <div>【回本周期】升级消耗回本${getPeriod(data.总消耗)}, 考虑勋章价格回本${getPeriod(data.总消耗 + buyPriceValue)}</div></div>`;
                };

                let html = '';
                if (BeatLv.level !== 'Max') {
                    html += renderLvl(BeatLv.level, BeatLv.value, false);
                }
                html += renderLvl('Max', MaxLv, true);
                return html;
            }
        };

        /**
         * 整合所有数据生成最终 HTML
         * @param {string|Array} levelsStr 等级：原始等级字符串或者已解析的obj
         * @param {object} imgsObj 图像数组
         * @param {string} buy_price 购买价格
         * @returns
         */
        const AllToHTML = (levelsStr, imgsObj, buy_price) => {
            let levelsObj

            if (utilInstance.objType(levelsStr) === "Array") levelsObj = levelsStr;
            levelsObj = parse.Levels(levelsStr);

            //  数据转换
            const { map: floatMap, BeatLv, MaxLv } = toHtml.LevelsFloat(levelsObj, "replay");
            const rawMap = toHtml.LevelsRaw(levelsObj);
            const imgMap = toHtml.Imgs(imgsObj);
            const costHTML = toHtml.CostInfo(levelsObj, buy_price, BeatLv, MaxLv);

            // 排序与拼接
            const toNum = v => (v === '初级' ? -Infinity : v === 'Max' ? Infinity : Number(v));

            const levelsHTML = Object.keys(levelsObj)
                .sort((a, b) => toNum(a) - toNum(b))
                .map(key => {
                    const title = (key === "Max" || key === "初级") ? `${key}` : `等级${key}`;
                    return `${imgMap[key] || '<span style="height:30px;"></span>'}
                        <div class="medal-level-name"><span>【</span><span style="flex-grow: 1;text-align: center;padding:0 2px;">${title}</span><span>】</span></div>
                        ${floatMap[key] || ''}
                        ${rawMap[key] || '<span></span>'}`;
                })
                .join('');

            return `<div class="medal-list-container"><div class="medal-list">${levelsHTML}</div></div><div class="medal-cost-count">${costHTML}</div>`;
        };

        return {
            AllToHTML,
            parse: parse.Levels,
            computeCost: compute.UpgradeCost
        };
    };


    /**
     * 缓存管理器：读取的IMG Blob 集合到内存中缓存，超过限制时候清除最早的图片
     */
    class ImageCacheManager {
        constructor(limit = 150) {
            this.limit = limit;
            this.cache = new Map(); // Map<fileName, blobUrl>
        }
        /**
         * 向Map中添加 fileName：blob url
         * @param {string} fileName 文件名
         * @param {string} url 文件blob url
         */
        add(fileName, url) {
            // 同名时候，移除后重新插入到末尾
            if (this.cache.has(fileName)) {
                URL.revokeObjectURL(this.cache.get(fileName));
                this.cache.delete(fileName);
            }
            this.cache.set(fileName, url);

            // 超过上限，释放最早的资源
            if (this.cache.size > this.limit) {
                const oldFileName = this.cache.keys().next().value;
                const oldUrl = this.cache.get(oldFileName);
                if (oldUrl) {
                    URL.revokeObjectURL(oldUrl);
                    this.cache.delete(oldFileName);
                    console.log(`[Cache] 自动释放冗余内存: ${oldFileName}`);
                }
            }
        }
        /**
         * 获取 Map[ fileName：blob url ] 中的 Blob URL
         * @param {string} fileName 文件名
         * @returns {string} 返回 Blob URL
         */
        get(fileName) {
            return this.cache.get(fileName);
        }
    }

    /**
     * 本地文件系统，1、将图片存储到本地磁盘，2、读取本地图片
     */
    class LocalFileSystem {
        /**
         * @param {ReturnType<typeof util>} utilInstance
         */
        constructor(utilInstance) {
            this.utilFunc = utilInstance;

            this.dirHandle = null;
            this.dbName = idbConf.dbName;
            this.storeName = "sys";
            this.recordName = 'dir_handle'
            this.cache = new ImageCacheManager(150);
            this.isProcessing = false;
            this.idb = idbstorage;
            this.curPermission = null;
        }
        async #saveHandle(handle) {
            try {
                this.idb.model(this.storeName).updateByField("idx_name", this.recordName, {
                    name: this.recordName,
                    handle: handle,
                    updatedAt: Date.now()
                })
                return true;
            } catch { return false; }
        }

        async #getHandle() {
            try {
                const results = await this.idb.model(this.storeName).query({ index: "idx_name", value: this.recordName })
                return results.length > 0 ? results[0].handle : null;
            } catch { return null; }
        }
        async getHandleName() {
            const s = await this.#getHandle()
            return s?.name
        }
        /**
         * 选择本地文件夹进行授权
         * @returns boolean
         */
        async authorize() {
            try {
                this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                console.log("this.dirHandle", this.dirHandle)
                await this.#saveHandle(this.dirHandle);
                return true;
            } catch { return false; }
        }
        /**
         * 站点的文件修改权限申请UI
         */
        async #showPermissionDialog(opts) {
            return new Promise((resolve) => {
                // 防止重复创建
                const old = document.querySelector('#fs-permission-mask');
                if (old) old.remove();

                // 遮罩
                const mask = document.createElement('div');

                mask.id = 'fs-permission-mask';

                Object.assign(mask.style, {
                    position: 'fixed',
                    inset: '0',
                    background: 'rgba(0,0,0,.45)',
                    zIndex: '999999',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(2px)',
                });

                const panel = document.createElement('div');

                Object.assign(panel.style, {
                    width: '320px',
                    background: '#fff',
                    borderRadius: '14px',
                    padding: '24px',
                    boxSizing: 'border-box',
                    textAlign: 'center',
                    boxShadow: '0 10px 40px rgba(0,0,0,.2)',
                    fontFamily: 'sans-serif',
                });

                panel.innerHTML = `
                    <div style="font-size:18px; font-weight:700; margin-bottom:12px;">需要文件夹权限</div>
                    <div style="font-size:14px; color:#666; line-height:1.6; margin-bottom:20px;">请点击下面按钮授权目录读写权限</div>
                `;

                // 按钮
                const btn = document.createElement('button');

                btn.textContent = '授权访问';

                Object.assign(btn.style, {
                    border: 'none',
                    background: '#1677ff',
                    color: '#fff',
                    padding: '10px 18px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                });

                panel.appendChild(btn);
                mask.appendChild(panel);
                document.body.appendChild(mask);
                btn.addEventListener('click', async () => {

                    try {
                        const newPerm = await this.dirHandle.requestPermission(opts);
                        resolve(newPerm);
                    } catch (err) {
                        console.error("授权失败:", err);
                        resolve(false);
                    } finally {
                        mask.remove();
                    }
                });
            });
        }
        /**
         * 验证浏览器的文件修改权限
         * @returns boolean
         */
        async verify() {

            if (!this.dirHandle) this.dirHandle = await this.#getHandle();
            if (!this.dirHandle) return false;
            const opts = { mode: 'readwrite' };

            const permission = await this.dirHandle.queryPermission(opts);

            if (permission === 'granted') {

                return true;
            }

            if (permission === 'denied') {
                console.error("权限被浏览器拒绝，请在地址栏设置中手动恢复！");
                return false;
            }
            // 询问权限
            if (this.curPermission === null) {
                this.curPermission = await this.#showPermissionDialog(opts);
                return this.curPermission === 'granted';
            } else if (this.curPermission !== "granted") {
                return false;
            }

        }

        /**
         * 保存文件到本地磁盘
         * @param {*} url 文件原始url
         * @returns 保存的数据 { fileName, blobData }
         */
        async saveFile(url) {

            const fileName = this.utilFunc.getFileNameFromUrl(url);
            const fileHandle = await this.dirHandle.getFileHandle(fileName, { create: true });

            return new Promise((resolve, reject) => {

                console.log("[下载图片任务] 开始下载：", fileName)
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url,
                    responseType: "blob",
                    onload: async (res) => {
                        let writable = null;
                        try {
                            const blobData = res.response;
                            writable = await fileHandle.createWritable();
                            await writable.write(blobData);
                            await writable.close();
                            console.log(`[下载图片任务] 保存本地成功: ${fileName}`);
                            resolve({
                                fileName,
                                blobData
                            });
                        } catch (err) {
                            if (writable) await writable.abort();
                            reject(err);
                        }
                    },
                    onerror: reject
                });
            });
        }

        /**
         * 从本地磁盘或者缓存中读取文件
         * @param {*} url 文件原始url
         * @returns string blob文件url
         */
        async getFile(url) {

            const fileName = this.utilFunc.getFileNameFromUrl(url);
            const existingUrl = this.cache.get(fileName);
            if (existingUrl) return existingUrl;

            const fileHandle = await this.dirHandle.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            const newUrl = URL.createObjectURL(file);

            this.cache.add(fileName, newUrl);

            return newUrl;

        }
    }
    const GLOBAL_THEME = `
        :host {
            --text-primary: #fcfdff;
            --text-secondary: #e3e3e3;
            --text-update: #dad1d1;
            --text-post: #90d5fd;
            --text-replay: #ef99ef;
            --text-rate: #ff4b4b;
            --color-a: #88bfff;
            --color-a-hover: #aed9fa;
            --bg-primary: rgba(21, 21, 21, 0.75);
            --bg-secondary: #969696;
            --bg-type: #0071ff;
            --shadow: #777777;
            --bg-scrollbar-thumb: rgba(157, 157, 157, 0.87);
            --bg-scrollbar-thumb-hover: rgba(219, 217, 217, 0.95) ;
            --bg-scrollbar-track: rgba(21, 21, 21, 0);
            --color-border: #a3a0a0;
        }
        :host[data-theme="light"] {
            --text-primary: #000000;
            --text-secondary: #000000;
            --text-update: #201e1e;
            --text-post: #00a1ff;
            --text-replay: #d43fd4;
            --text-rate: #db0000;
            --color-a: #0075fd;
            --color-a-hover: #16a2f8;
            --bg-primary: rgb(255 255 255 / 90%);
            --bg-secondary: #969696;
            --bg-type: #a0cfff;
            --shadow: #a7a7a7;
            --bg-scrollbar-thumb: rgb(193 193 193 / 95%);
            --bg-scrollbar-thumb-hover: rgba(157, 157, 157, 0.87);
            --bg-scrollbar-track: rgba(21, 21, 21, 0);
            --color-border: #a3a0a0;
        }
    `;
    /**
     * 勋章放大镜
    */
    class MedalMagnifier {
        /**
         * @param {any[]} medalData - 勋章数据
         * @param {any[]} medalDataNoTid - 未记录到博物馆的勋章数据
         * @param {ReturnType<typeof util>} utilInstance - 工具函数
         * @param {ReturnType<typeof createConvertLEVELS>} convertLEVELS - 解析等级函数
         * @param {LocalFileSystem} localFileObj - 本地图片系统
         * @param {ControlPanel} controlPanel - 控制面板
         */
        constructor(medalData, medalDataNoTid, utilInstance, convertLEVELS, localFileObj, controlPanel) {
            this.medalData = medalData;
            this.medalDataNoTid = medalDataNoTid;
            this.utilFunc = utilInstance;
            this.convertFunc = convertLEVELS;
            this.controlPanelObj = controlPanel;
            this.localFile = localFileObj;

            this.el = null;
            this._hideTimer = null;
            this._hideTimerLock = false; // 全局状态锁 防止事件代理先触发而this.el的mouseleave后触发

            // 缓存已经查询过的节点
            this.nodeCache = new WeakMap();
            // 转换 this.medalData 为 以name为键的Map
            this.medalMap = null;


            // 初始化
            this.initDB();
            this.createElement();
            this.initAllBindListen();
            this.GM_registerMenu();
        }
        getMagnifierTheme() {
            return this.controlPanelObj.getTheme();
        }
        getMagnifierStatus() {
            return this.controlPanelObj.getBasicByKey("medalMagnifier");
        }
        getPositionMode() {
            return this.controlPanelObj.getBasicByKey("positionMode");
        }
        getShowImgStatus() {
            return this.controlPanelObj.getBasicByKey("showImage");
        }
        getLocalImgStatus() {
            return this.controlPanelObj.getBasicByKey("localImageMode");
        }
        initDB() {

            this.controlPanelObj.addUpdateFunc(this.updateForced);

            //idb数据更新
            (async () => {
                const s = await idbstorage.model('sys').count();
                const c = await idbstorage.model('award_info').count();
                console.log(`award_info数据库表，总条数：${c}\nsys数据库表，总条数：${s}`)
                const m_count = this.medalData.length
                const mNo_count = this.medalDataNoTid.length
                const num = m_count + mNo_count;
                if (num !== c) {
                    console.log(`award_info数据库表条数和脚本内部不匹配，清空数据库表`)
                    await idbstorage.model('award_info').clear();

                    const sortedData = [...this.medalData]
                        .sort((a, b) => a.no - b.no)
                        .map(a => ({
                            ...a,
                            name_cleansing: this.utilFunc.name_cleansing(a.name),
                            levels: this.convertFunc.parse(a.levels)
                        }));
                    const sortedDataNoTid = [...this.medalDataNoTid]
                        .map(a => ({
                            ...a,
                            name_cleansing: this.utilFunc.name_cleansing(a.name),
                            levels: this.convertFunc.parse(a.levels)
                        }));
                    await idbstorage.model('award_info').addBatch(sortedData);
                    await idbstorage.model('award_info').addBatch(sortedDataNoTid);
                    const c = await idbstorage.model('award_info').count();
                    console.log(`award_info数据库表，插入条数：${c}（博物馆：${m_count}；非博物馆${mNo_count}）`)
                }
            })();

        }
        /** 强制更新本地idb */
        updateForced = () => {
            (async () => {
                await idbstorage.model('award_info').clear();

                const sortedData = [...this.medalData]
                    .sort((a, b) => a.no - b.no)
                    .map(a => ({
                        ...a,
                        name_cleansing: this.utilFunc.name_cleansing(a.name),
                        levels: this.convertFunc.parse(a.levels)
                    }));
                const sortedDataNoTid = [...this.medalDataNoTid]
                    .map(a => ({
                        ...a,
                        name_cleansing: this.utilFunc.name_cleansing(a.name),
                        levels: this.convertFunc.parse(a.levels)
                    }));
                await idbstorage.model('award_info').addBatch(sortedData);
                await idbstorage.model('award_info').addBatch(sortedDataNoTid);
                const c = await idbstorage.model('award_info').count();
                const s = await idbstorage.model('sys').count();
                const m_count = this.medalData.length
                const mNo_count = this.medalDataNoTid.length
                console.log(`award_info数据库表，插入条数：${c}（博物馆：${m_count}；非博物馆${mNo_count}）`)
                console.log(`sys数据库表，总条数：${s}`)
            })();
        }

        createElement() {
            const medalID = 'medal-container-detail'
            this.el = document.getElementById(medalID);
            if (this.el) return;

            this.el = document.createElement('div');
            this.el.id = medalID;
            this.el.className = medalID;
            let themedCss = GLOBAL_THEME.replaceAll(':host', `.${medalID}`);
            this.el.setAttribute('data-theme', 'light')
            const css = /* css */`
                ${themedCss}
                .${medalID} {
                    position: fixed;
                    padding: 4px;
                    font-size: 13px;
                    border-radius: 5px;
                    z-index: 10000;
                    font-weight: 500;
                    color: var(--text-primary);
                    box-shadow: 0 6px 24px 6px var(--shadow);
                    background: none;
                    overflow: hidden;
                    display: none;
                    opacity: 0;
                    font-family: '等线' , "Microsoft YaHei Light" , system-ui, sans-serif;;
                }
                .${medalID}[data-theme="light"] {
                    font-family: "Microsoft YaHei" , system-ui, sans-serif;;
                }
                /* 磨砂层：负责模糊图片 */
                .${medalID}::before {
                    content: "";
                    position: absolute;
                    top: -20px; left: -20px; right: -20px; bottom: -20px;
                    z-index: -1;
                    background: url('data:image/jpeg;base64,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') no-repeat center;
                    background-size: cover;
                    filter: blur(14px);
                }
                .${medalID}::after {
                    content: "";
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    z-index: -1;
                    background: var(--bg-primary);
                }
                .${medalID} a {
                    color: var(--color-a);
                }
                .${medalID} a:hover {
                    color: var(--color-a-hover);
                }
                .${medalID} .medal-header {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    justify-content: center;
                }
                .${medalID} .medal-title {
                    font-weight: 600;
                    display: flex;
                    align-items: flex-end;
                    padding-left: 4px;
                    line-height: 1;
                    font-size: 16px;
                    padding-bottom: 4px;
                }
                .${medalID} .medal-name {
                    margin: 0 12px 0 6px;
                }
                .${medalID} .medal-type {
                    background: var(--bg-type);
                    border-radius: 3px;
                    padding: 2px 8px;
                    font-size: 15px;
                }
                .${medalID} .level-img img {
                    vertical-align: middle;
                    object-fit: contain;
                    height: 43px;
                }
                .${medalID} .level-img {
                    height: 43px;
                    display: flex;
                    justify-content: flex-start;
                    align-items: center;
                }
                .${medalID} .level-img.none {
                    filter: grayscale(100%);
                }
                .${medalID} .medal-floats.total{
                    font-weight: 600;
                    color: var(--text-secondary);
                }
                .${medalID} .medal-replay {
                    color: var(--text-replay);
                }
                .${medalID} .medal-post {
                    color: var(--text-post);
                }
                .${medalID} .medal-upgrade {
                    color: var(--text-update);
                }
                .${medalID} .medal-list-container{
                    padding: 4px 0 4px 4px;
                    margin: 4px 0;
                    border-top: 1px solid var(--color-border);
                    border-bottom: 1px solid var(--color-border);
                }
                .${medalID} .medal-list {
                    display: grid;
                    grid-template-columns: max-content max-content max-content max-content max-content auto;
                    gap: 6px 4px;
                    align-items: center;
                    max-height: 370px;
                    overflow: auto;
                    padding-right: 8px;
                }
                .${medalID} .medal-list::-webkit-scrollbar {
                    width: 10px;
                    height: 10px;
                }
                .${medalID} .medal-list::-webkit-scrollbar-thumb {
                    border-radius: 5px;
                    background: var(--bg-scrollbar-thumb);
                }
                .${medalID} .medal-list::-webkit-scrollbar-track {
                    border-radius: 5px;
                    background: var(--bg-scrollbar-track);
                }
                .${medalID} .medal-list::-webkit-scrollbar-corner {
                    background: var(--bg-scrollbar-track);
                }
                .${medalID} .medal-list::-webkit-scrollbar-thumb:hover {
                    background-color: var(--bg-scrollbar-thumb-hover);
                }
                @supports (scrollbar-width: thin) and (not selector(::-webkit-scrollbar-thumb)) {
                    .${medalID} .medal-list {
                        scrollbar-color: var(--bg-scrollbar-thumb) var(--bg-scrollbar-track); ;
                    }
                }
                .${medalID} .medal-floats svg{
                    width: 15px;
                    height: 15px;
                    vertical-align: text-bottom;
                    margin: 0 2px;
                    display: inline-block;
                }
                .${medalID} .medal-raw{
                    gap: 6px;
                    display: flex;
                    white-space: nowrap;
                }
                .${medalID} .medal-rate{
                    color: var(--text-rate);
                    padding: 0 2px;
                }
                .${medalID} .medal-cost-count{
                    color: var(--text-secondary);
                }
                .${medalID} .medal-level-name {
                    display: flex;
                    justify-content: space-between;
                    padding: 0 4px;
                }
                .medal-level-name span:first-child {
                    margin-left: -8px;
                }
                .medal-level-name span:last-child {
                    margin-right: -8px;
                }
            `;
            const style = document.createElement('style');
            style.id = `${medalID}-style`
            style.innerHTML = css;
            document.head.appendChild(style);
            document.body.appendChild(this.el);

            this.el.addEventListener('mouseenter', () => { clearTimeout(this._hideTimer); });
            this.el.addEventListener('mouseleave', () => {
                if (this._hideTimerLock) return
                this._hideTimer = setTimeout(() => {
                    this.hide();
                }, 250);
            });
        }

        generateTemplate(item) {
            const noText = item?.no ? `<span style="font-size:18px">No.</span><span class="medal-no">${item.no}</span >` : '';
            const typeText = item?.type ? `<span class="medal-type">${item.type}</span>` : '';
            const nameText = item?.name ? `<span class="medal-name">${item.name}</span>` : '';
            const backstoryText = item?.backstory ? `<span class="medal-backstory">【背景故事】${item.backstory}</span>` : ''
            const tidText = (item?.date && item?.url_tid)
                ? `<span class="medal-create">【创建时间】<a href="/thread-${item.url_tid}-1-1.html" target="_blank">${item.date}（前往博物馆）</a></span>`
                : (item?.date ? `<span class="medal-create">【创建时间】${item.date}</span>` : '');
            const buyLimitText = (item?.buy_limit && item?.buy_limit !== '无') ? `<span class="medal-buyLimit">【购买条件】${item.buy_limit}</span>` : '';
            const priceText = item?.price ? `<span class="medal-price">【商店售价】${item.price}</span>` : '';
            const durationText = item?.duration ? `<span class="medal-duration">【持续时间】${item.duration}</span>` : '';
            // 处理item.levels内容，加上img和回帖概率以小数显示
            const levelsALLHTML = this.convertFunc.AllToHTML(item?.levels, (this.showImg ? item?.levels_img_local : ''), item?.price)

            return `<div class="medal-header"><div class="medal-title">${noText}${nameText}<span style="flex-grow:1"></span>${typeText}</div>${tidText}${backstoryText}${buyLimitText}${priceText}${durationText}</div> ${levelsALLHTML}`;
        }

        // 后台下载图片，完成后缓存
        async _backgroundDownloadAndCache(src) {
            try {
                const saveResult = await this.localFile.saveFile(src);
                if (saveResult?.blobData) {
                    const newUrl = URL.createObjectURL(saveResult.blobData);
                    this.localFile.cache.add(saveResult.fileName, newUrl);
                }
            } catch (err) {
                if (err.name === 'NotAllowedError') console.error("写入本地权限丢失");
                if (err.name === 'NotFoundError') console.error("无法找到文件夹，请确认文件夹是否移动或者重命名！");
            }
        }
        // 获取本地图片，有返回blob，没有直接返回原src（开启后台下载图片）
        async getLocalImg(imgsObj) {
            if (!imgsObj) return {};
            if (!this.getShowImgStatus()) return {};

            // 如果未开启本地图片功能，直接返回原网络数据
            if (!this.getLocalImgStatus()) return imgsObj;

            // 校验授权，失败直接返回原图
            if (!(await this.localFile.verify())) {
                console.warn("未获得本地文件系统授权，跳过存储");
                return imgsObj;
            }

            const entries = Object.entries(imgsObj);
            const downloadLock = new Map(); // 用于多张图指向同一 src 时，防止重复触发后台下载

            const processedEntries = await Promise.all(
                entries.map(([key, [src, width]]) =>
                    limit(async () => {
                        if (!src) return [key, ["", width]];

                        try {
                            // 尝试读取本地缓存/本地文件
                            let localSrc = await this.localFile.getFile(src);
                            if (localSrc) {
                                // 本地有，直接返回 Blob URL
                                return [key, [localSrc, width]];
                            }
                        } catch (err) {
                            if (err.name === 'NotAllowedError') console.error("获取本地文件权限丢失");
                        }

                        // 本地没有缓存，不等待下载，直接准备返回原网络 src
                        // 为了防止并行的请求同时去下载同一个 src，用 lock 锁一下后台任务
                        if (!downloadLock.has(src)) {
                            // 触发后台下载
                            const bgTask = this._backgroundDownloadAndCache(src);
                            downloadLock.set(src, bgTask);
                        }

                        // 立刻返回原网络 src，混合加载，不阻塞渲染
                        return [key, [src, width]];
                    })
                )
            );

            downloadLock.clear();
            return Object.fromEntries(processedEntries);
        }
        /**
         * 显示放大镜面板
         * @param {*} targetEL 目标节点
         * @param {string} type 数据的类型，name 或者 item
         * @param {array} typeValue 数据，type=name进行this.medalData查询；type=item时候直接使用此数据
         * @param {boolean} position 定位方式，普通左侧/上下定位、排行榜定位、补货日志定位
         * @returns
         */
        async show(targetEL, type = "name", typeValue, position = "default") {
            this.showImg = this.getShowImgStatus() ?? false;
            if (!this.getMagnifierStatus()) return;
            if (position === "saltfish" && (!(await this.localFile.verify()) || !this.getLocalImgStatus())) this.showImg = false; // 跨域问题无法显示图片

            this.el.setAttribute('data-theme', this.getMagnifierTheme());

            let items
            if (type === "name") {
                items = this.medalData.filter(m => m.name === typeValue);
                if (items.length === 0) return;
            } else {
                items = typeValue
            }

            // 立即清理旧的副面板
            this.removeSubMedals();

            // 渲染并定位主勋章
            items[0].levels_img_local = await this.getLocalImg(items[0].levels_img);

            this.el.innerHTML = this.generateTemplate(items[0]);
            this.el.style.display = 'block';
            this.el.style.visibility = 'hidden';


            // 调用对应的定位方法
            switch (position) {
                case 'default':
                    this.getPositionMode() === 'left'
                        ? this.positionLeft(targetEL)
                        : this.positionTop(targetEL);
                    break;
                case 'rank':
                    this.positionRank(targetEL);
                    break;
                case 'saltfish':
                    this.positionSaltfish(targetEL);
                    break;
            }

            this.el.style.visibility = 'visible';
            this.el.style.opacity = '1';

            //  处理后续子勋章
            if (items.length > 1) {
                let lastRect = this.el.getBoundingClientRect();
                const spacing = 5;

                for (let i = 1; i < items.length; i++) {
                    const subEl = document.createElement('div');
                    subEl.className = this.el.className;
                    subEl.classList.add('medal-sub-panel-extra');
                    subEl.setAttribute('data-theme', this.getMagnifierTheme());
                    items[i].levels_img_local = await this.getLocalImg(items[i].levels_img);
                    subEl.innerHTML = this.generateTemplate(items[i]);

                    //  预渲染以获取高度
                    Object.assign(subEl.style, {
                        position: 'fixed',
                        left: '-9999px',
                        top: '0',
                        display: 'block',
                        visibility: 'hidden',
                        opacity: '0',
                    });

                    document.body.appendChild(subEl);

                    const subHeight = subEl.offsetHeight;
                    const windowHeight = window.innerHeight;

                    // 计算定位（默认下方）
                    let topPos = lastRect.bottom + spacing;

                    // 防溢出检测
                    if (topPos + subHeight > windowHeight) {
                        // 下方放不下，尝试往上放
                        topPos = lastRect.top - subHeight - spacing - 10;
                    }
                    let side = "left";
                    if (document.querySelector('#rank-info-window').getBoundingClientRect().left > windowHeight / 2) side = "right";
                    let left
                    if (side === "left") left = lastRect.left + 'px';
                    else { left = (lastRect.right - subEl.offsetWidth) + 'px'; }
                    // 最终应用正确位置
                    Object.assign(subEl.style, {
                        left: left,
                        top: topPos + 'px',
                        visibility: 'visible',
                        zIndex: '10000',
                        opacity: '1',
                    });

                    // 更新参考坐标
                    lastRect = subEl.getBoundingClientRect();

                    subEl.addEventListener('mouseenter', () => { clearTimeout(this._hideTimer); });
                    subEl.addEventListener('mouseleave', () => {
                        if (this._hideTimerLock) return
                        this._hideTimer = setTimeout(() => {
                            this.hide();
                        }, 250);
                    });
                }
            }
        }

        // 清理副面板方法
        removeSubMedals() {
            const extras = document.querySelectorAll('.medal-sub-panel-extra');
            extras.forEach(el => el.remove());
        }
        // 隐藏放大镜面板
        hide() {
            if (!this.el) return;
            this.el.style.opacity = '0';
            this.el.style.display = 'none';
            this.removeSubMedals();
        }
        // 定位放大镜，上下定位
        positionTop(target) {
            const rect = target.getBoundingClientRect(); // 获取目标相对于窗口的坐标
            const elWidth = this.el.offsetWidth;
            const elHeight = this.el.offsetHeight;
            const vWidth = window.innerWidth;   // 视口宽度
            const vHeight = window.innerHeight; // 视口高度

            let left = rect.left + (rect.width / 2) - (elWidth / 2);

            let top = rect.top - elHeight - 10;

            // 垂直边界判断
            if (top < 10) {
                top = rect.bottom + 10;
            }

            // 显示在下方还超出了窗口底部，强制贴合在底部（保留10px间距）
            if (top + elHeight > vHeight - 10) {
                top = vHeight - elHeight - 10;
            }

            // 水平边界判断 (限制在窗口 10px 边距内)
            const minLeft = 10;
            const maxLeft = vWidth - elWidth - 10;
            left = Math.max(minLeft, Math.min(left, maxLeft));

            this.el.style.left = left + 'px';
            this.el.style.top = top + 'px';

        }
        // 定位放大镜，左侧定位
        positionLeft(img) {
            const labels = document.querySelectorAll(".MyshowTip2");

            labels.forEach(label => {
                if (label.style.display !== 'none') {

                    this.el.style.width = '';
                    // 获取放大镜的高度、宽度
                    let h = this.el.offsetHeight;
                    const w = this.el.offsetWidth;

                    const labelRect = label.getBoundingClientRect();
                    const viewportHeight = window.innerHeight;

                    let left = labelRect.left - w - 1;
                    if (left < 0) {
                        left = 2;
                        this.el.style.width = labelRect.left - 4 + "px";
                        // 重新获取放大镜的高度(包含滚动条)
                        h = this.el.offsetHeight
                    }
                    // 对齐 .MyshowTip2 顶部
                    let top = labelRect.top;

                    const imgTop = img.getBoundingClientRect().top;
                    // 对齐 .MyshowTip2 底部
                    if (labelRect.top < imgTop) {
                        top = labelRect.top + labelRect.height - h;
                    }

                    top = Math.max(2, top);
                    // 对齐屏幕底部
                    if (top + h > viewportHeight) {
                        top = viewportHeight - h - 6;
                    }
                    this.el.style.top = top + 'px';
                    this.el.style.left = left + 'px';
                }
            });
            this.medalListAddListener();

        }
        // 定位放大镜，排行榜定位
        positionRank(target) {
            const rect = target.getBoundingClientRect(); // 获取目标相对于窗口的坐标

            const w = document.querySelector('#rank-info-window').getBoundingClientRect().width; // 标题栏的宽度

            const elWidth = this.el.offsetWidth;
            const elHeight = this.el.offsetHeight;
            const vWidth = window.innerWidth;   // 视口宽度
            const vHeight = window.innerHeight; // 视口高度

            let side = "left";
            if (rect.left > vWidth / 2) side = "right";
            let left
            if (side === "left") left = rect.left + w + 8;
            else left = rect.left - elWidth - 8;

            let top = rect.top + rect.height - elHeight;

            // 垂直边界判断
            if (top < 10) {
                top = rect.bottom + 10;
            }

            // 显示在下方还超出了窗口底部，强制贴合在底部（保留10px间距）
            if (top + elHeight > vHeight - 10) {
                top = vHeight - elHeight - 10;
            }

            // 水平边界判断 (限制在窗口 10px 边距内)
            const minLeft = 10;
            const maxLeft = vWidth - elWidth - 10;
            left = Math.max(minLeft, Math.min(left, maxLeft));

            this.el.style.left = left + 'px';
            this.el.style.top = top + 'px';

        }
        // 定位放大镜，补货日志定位
        positionSaltfish(target) {
            const rect = target.getBoundingClientRect(); // 获取目标相对于窗口的坐标

            const w = rect.width; // 标题栏的宽度

            const elWidth = this.el.offsetWidth;
            const elHeight = this.el.offsetHeight;
            const vWidth = window.innerWidth;   // 视口宽度
            const vHeight = window.innerHeight; // 视口高度

            let side = "left";
            if (rect.left > vWidth / 2) side = "right";
            let left
            if (side === "left") left = rect.left + w + 12;
            else left = rect.left - elWidth - 8;

            let top = rect.top + rect.height - elHeight;

            // 垂直边界判断
            if (top < 10) {
                top = rect.bottom + 10;
            }

            // 显示在下方还超出了窗口底部，强制贴合在底部（保留10px间距）
            if (top + elHeight > vHeight - 10) {
                top = vHeight - elHeight - 10;
            }

            // 水平边界判断 (限制在窗口 10px 边距内)
            const minLeft = 10;
            const maxLeft = vWidth - elWidth - 10;
            left = Math.max(minLeft, Math.min(left, maxLeft));

            this.el.style.left = left + 'px';
            this.el.style.top = top + 'px';
        }
        /**
         * medalList添加横向滚动监听
         */
        medalListAddListener = () => {
            const medalList = document.querySelector('.medal-list');
            if (!medalList) return;
            this.handleWheel = (e) => {
                // 判断条件：X轴可滚动 且 Y轴不可滚动
                const canScrollX = medalList.scrollWidth > medalList.clientWidth;
                const canScrollY = medalList.scrollHeight > medalList.clientHeight;

                if (canScrollX && !canScrollY) {
                    // 只有当用户在垂直滚动(deltaY)时，才将其转为水平滚动
                    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                        e.preventDefault();
                        medalList.scrollLeft += e.deltaY * 0.8;
                    }
                }
            };
            medalList.removeEventListener('wheel', this.handleWheel);
            // 绑定
            medalList.addEventListener('wheel', this.handleWheel, { passive: false });
        }
        /**
         * 获取this.medalData this.medalDataNoTid的查询结果
         * @param {string} name - 当前需要查询匹配的关键字
         * @returns 返回数组或者null
         */
        getMatchedItem = (name) => {

            if (!name) return null;

            // 第一次运行或 Map 为空时，初始化索引
            if (!this.medalMap) {
                this.medalMap = new Map();
                for (const item of this.medalData) {
                    const n = this.utilFunc.name_cleansing(item.name)
                    // 如果 Map 中还没有这个名字，初始化一个空数组
                    if (!this.medalMap.has(n)) {
                        this.medalMap.set(n, []);
                    }
                    // 将具有相同名字的数据项推入数组
                    this.medalMap.get(n).push(item);
                }
                for (const item of this.medalDataNoTid) {
                    const n = this.utilFunc.name_cleansing(item.name)
                    // 如果 Map 中还没有这个名字，初始化一个空数组
                    if (!this.medalMap.has(n)) {
                        this.medalMap.set(n, []);
                    }
                    // 将具有相同名字的数据项推入数组
                    this.medalMap.get(n).push(item);
                }
            }

            // 获取查询关键字的变体
            const variants = this.utilFunc.name_variants(name);

            // 查询逻辑
            for (const v of variants) {
                if (this.medalMap.has(v)) return this.medalMap.get(v);
            }

            return null;
        };
        /**
         * 事件代理监听 通用方法
         */
        initAllBindListen() {
            // 配置驱动
            this.bindConfigs = [
                {
                    type: "default",
                    container: "#ct.wodexunzhang",
                    target: ".myimg img",
                    delay: 50,
                    touchDelay: 350,
                    getId: (el) => el.getAttribute('alt')
                },
                {
                    type: "rank",
                    container: "#rank-info-scroll.clusterize-scroll",
                    target: ".rank-info-row",
                    delay: 250,
                    getId: (el) => el.querySelector('.rank-info-name')?.textContent?.trim()
                },
                {
                    type: "saltfish",
                    container: ".el-table__body-wrapper",
                    target: "tr.el-table__row td:first-child",
                    delay: 250,
                    getId: (el) => el.querySelector('.cell div')?.title?.trim()
                }
            ];

            // 动态生成全局点击过滤的选择器串
            const allTargetsSelector = this.bindConfigs.map(c => c.target).join(', ');

            // 遍历配置并绑定逻辑
            this.bindConfigs.forEach(conf => {
                const tryBind = () => {
                    const container = document.querySelector(conf.container);
                    if (!container) return false;

                    let hoverTimer = null;

                    // pointerover 移入逻辑
                    container.addEventListener('pointerover', (event) => {

                        const targetEl = event.target.closest(conf.target);
                        if (!targetEl || (event.relatedTarget && targetEl.contains(event.relatedTarget))) return;

                        clearTimeout(hoverTimer);
                        clearTimeout(this._hideTimer);
                        this._hideTimerLock = true;

                        const delay = event.pointerType === 'touch' ? (conf.touchDelay ?? 350) : (conf.delay ?? 200);
                        hoverTimer = setTimeout(() => {
                            const txt = conf.getId(targetEl);
                            if (!txt) return;

                            const matchedItem = this.getMatchedItem(txt);
                            if (matchedItem) this.show(targetEl, "item", matchedItem, conf.type);
                            else { this.hide(); this._hideTimerLock = false; }
                        }, delay);
                    });

                    // pointerout 移出逻辑
                    container.addEventListener('pointerout', (event) => {
                        if (event.pointerType === 'touch') return;

                        const targetEl = event.target.closest(conf.target);
                        if (targetEl && (!event.relatedTarget || !targetEl.contains(event.relatedTarget))) {
                            clearTimeout(hoverTimer);
                            clearTimeout(this._hideTimer);
                            this._hideTimerLock = false;

                            this._hideTimer = setTimeout(() => {
                                // 确保鼠标既不在触发源上，也不在提示框上
                                const isHoveringTooltip = this.el && this.el.matches(':hover');
                                const isHoveringTarget = targetEl.matches(':hover');
                                if (!isHoveringTooltip && !isHoveringTarget) this.hide();
                            }, 400);
                        }
                    });

                    // 移动端点击页面关闭
                    if (!this._hasGlobalClick) {
                        document.addEventListener('click', (event) => {
                            if (event.pointerType !== 'touch') return;

                            const isClickTrigger = event.target.closest(allTargetsSelector);
                            const isClickTooltip = this.el && this.el.contains(event.target);

                            if (!isClickTrigger && !isClickTooltip) {
                                clearTimeout(hoverTimer);
                                this._hideTimerLock = false;
                                this.hide();
                            }
                        });
                        this._hasGlobalClick = true;
                    }
                    return true;
                };

                // 执行绑定，若失败则启动观察器
                if (!tryBind()) {
                    const observer = new MutationObserver((mutations, obs) => {
                        if (document.querySelector(conf.container)) {
                            if (tryBind()) obs.disconnect();
                        }
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                }
            });
        }
        GM_registerMenu() {
            GM_registerMenuCommand("控制面板", () => {
                this.controlPanelObj.show();
            }, "h");
        }
    }


    const observer = new MutationObserver((mutations, obs) => {
        if (document.body) {
            obs.disconnect();

            const managerRef = { instance: null };
            // 工具函数
            const u = util(managerRef)
            // 解析函数
            const convertLEVELS = createConvertLEVELS(u);
            // 本地文件系统
            const localFileObj = new LocalFileSystem(u);

            // Toast提示组件
            const myToast = new ToastManager();
            //  控制面板组件
            const controlPanel = new ControlPanel({
                toastInstance: myToast,
                storageKey: 'ULTRA_CONFIG_V3',
                localFile: localFileObj,
            });

            managerRef.instance = controlPanel;

            // 放大镜
            const app = new MedalMagnifier(medalData, medalDataNoTid, u, convertLEVELS, localFileObj, controlPanel);
            console.log("控制面板已成功启动！")
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

})();

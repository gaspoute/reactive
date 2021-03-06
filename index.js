import isPlainObject from 'is-plain-obj';
import dotProp from 'dot-prop';
import {targets, peek} from './targets';

const {has, get} = dotProp;
const noop = () => {};

// Inspired by Vue.js (https://vuejs.org)

function reactive(object, key, value = object[key]) {
	const dependency = {subscriptions: []};
	const {get: getter, set: setter} = Object.getOwnPropertyDescriptor(object, key) || {};
	const seed = object._seed || object;
	let deep = inspect(value, {seed});
	return Object.defineProperty(object, key, {
		configurable: true,
		enumerable: true,
		get() {
			const target = peek(targets);
			if (target) {
				depend(dependency, target);
				if (deep) {
					depend(value._dependency, target);
				}
				if (Array.isArray(value)) {
					dependEach(value, target);
				}
			}
			return getter ? getter.call(object) : value;
		},
		set(newValue) {
			const oldValue = getter ? getter.call(object) : value;
			if (newValue === oldValue) {
				return;
			}
			if (setter) {
				setter.call(object, newValue);
			} else {
				value = newValue;
			}
			deep = inspect(newValue, {seed});
			notify(dependency);
		}
	});
}

function dependEach(values, watcher) {
	for (let i = 0; i < values.length; ++i) {
		const value = values[i];
		if (value && value._dependency) {
			depend(value._dependency, watcher);
		}
		if (Array.isArray(value)) {
			dependEach(value, watcher);
		}
	}
}

function depend(dependency, watcher) {
	if (!dependency.subscriptions.includes(watcher)) {
		dependency.subscriptions.push(watcher);
	}
	if (!watcher.dependencies.includes(dependency)) {
		watcher.dependencies.push(dependency);
	}
}

function notify({subscriptions}) {
	for (let i = 0; i < subscriptions.length; ++i) {
		inform(subscriptions[i]);
	}
}

function observe(value) {
	return inspect(value);
}

function inspect(value, options = {}) {
	if ((!isPlainObject(value) && !Array.isArray(value)) || !Object.isExtensible(value)) {
		return;
	}
	if (value._dependency) {
		return value;
	}
	const _dependency = {subscriptions: []};
	Object.defineProperty(value, '_dependency', {value: _dependency});
	if (!options.seed && !value._watchers) {
		const _watchers = [];
		Object.defineProperty(value, '_watchers', {value: _watchers});
	}
	if (options.seed && !value._seed) {
		Object.defineProperty(value, '_seed', {value: options.seed});
	}
	if (Array.isArray(value)) {
		inspectEach(value, Object.assign(options, {seed: value}));
	} else {
		const keys = Object.keys(value);
		for (let i = 0; i < keys.length; ++i) {
			const key = keys[i];
			if (isComputed(value[key])) {
				computed(value, key);
			} else {
				reactive(value, key);
			}
		}
	}
	return value;
}

function isComputed(value) {
	return typeof value === 'function' || (isPlainObject(value) && value.get);
}

function inspectEach(values, options) {
	for (let i = 0; i < values.length; ++i) {
		observe(values[i], options);
	}
}

function watch(object, path, update, options = {}) {
	const {deep = false, lazy = false} = options;
	const getter = typeof path === 'function' ? path : () => get(object, path);
	const watcher = {
		update,
		deep,
		lazy,
		active: true,
		dirty: lazy,
		dependencies: [],
		getter
	};
	const seed = object._seed || object;
	seed._watchers.push(watcher);
	return Object.assign(watcher, {value: lazy ? undefined : getValue(watcher, options)});
}

function getValue(watcher) {
	const oldDependencies = [...watcher.dependencies];
	watcher.dependencies.length = 0;
	targets.push(watcher);
	const value = watcher.getter();
	if (watcher.deep) {
		traverse(value);
	}
	targets.pop();
	cleanUp(watcher, oldDependencies);
	return value;
}

function cleanUp(watcher, oldDependencies) {
	const removedDependencies = oldDependencies.filter(oldDependency => !watcher.dependencies.includes(oldDependency));
	for (let i = 0; i < removedDependencies.length; ++i) {
		const removedDependency = removedDependencies[i];
		const index = removedDependency.subscriptions.indexOf(watcher);
		removedDependency.subscriptions.splice(index, 1);
	}
}

function traverse(value, seen = []) {
	if ((!isPlainObject(value) && !Array.isArray(value)) || !Object.isExtensible(value)) {
		return;
	}
	if (value._dependency) {
		if (seen.includes(value._dependency)) {
			return;
		}
		seen.push(value._dependency);
	}
	if (Array.isArray(value)) {
		traverseEach(value, seen);
	} else {
		const keys = Object.keys(value);
		for (let i = 0; i < keys.length; ++i) {
			traverse(value[keys[i]], seen);
		}
	}
}

function traverseEach(values, seen) {
	for (let i = 0; i < values.length; ++i) {
		traverse(values[i], seen);
	}
}

function inform(watcher) {
	const {value: oldValue} = watcher;
	if (watcher.lazy) {
		watcher.dirty = true;
	} else if (watcher.active) {
		const value = getValue(watcher);
		if (oldValue !== value || isPlainObject(value) || watcher.deep) {
			watcher.value = value;
			watcher.update(value, oldValue);
		}
	}
}

function evaluate(watcher) {
	watcher.dirty = false;
	watcher.value = getValue(watcher);
}

function computed(object, key) {
	const compute = typeof object[key] === 'function' ? object[key] : object[key].get;
	const watcher = watch(object, compute, noop, {lazy: true});
	return Object.defineProperty(object, key, {
		configurable: true,
		enumerable: true,
		get() {
			if (watcher.dirty) {
				evaluate(watcher);
			}
			const target = peek(targets);
			if (target) {
				for (let i = 0; i < watcher.dependencies.length; ++i) {
					depend(watcher.dependencies[i], target);
				}
			}
			return watcher.value;
		},
		set: typeof object[key] === 'function' ? noop : (object[key].set || noop)
	});
}

function set(object, key, value) {
	if (has(object, key)) {
		object[key] = value;
		return value;
	}
	if (!object._dependency) {
		object[key] = value;
		return value;
	}
	reactive(object, key, value);
	notify(object._dependency);
	return value;
}

function unset(object, key) {
	if (!has(object, key)) {
		return;
	}
	delete object[key];
	if (!object._dependency) {
		return;
	}
	notify(object._dependency);
}

function ignore(watcher) {
	if (!watcher.active) {
		return;
	}
	for (let i = 0; i < watcher.dependencies.length; ++i) {
		const dependency = watcher.dependencies[i];
		dependency.subscriptions = dependency.subscriptions.filter(subscription => subscription !== watcher);
	}
	watcher.active = false;
}

export {observe, watch, ignore, set, unset};

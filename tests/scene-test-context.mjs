import vm from 'node:vm';
import { buildNetwork as buildNetworkGraph, updateNetworkGeometry } from '../scene/network.mjs';
import { getTopologyDesign, createTopologyMotionState } from '../network-topology-design/index.mjs';

// Legacy scene tests still extract unconverted main-module consumers. Supply
// their imports explicitly while graph construction/motion run as real modules.
export function createSceneContext(values) {
  return vm.createContext({
    buildNetworkGraph, updateNetworkGeometry, getTopologyDesign, createTopologyMotionState, ...values,
  });
}

import type { ToolName } from './types.js';
import { IMAGE_TOOLS } from './images.js';

const INTERNAL_TOOLS: ToolName[] = ['proton_info'];
const EXTERNAL_TOOLS: ToolName[] = ['web_search', 'weather', 'stock', 'cryptocurrency'];

/** Native Lumo tools to advertise on the Proton request. */
export function selectNativeTools(options: {
    includeInternal: boolean;
    webSearch: boolean;
    images: boolean;
}): ToolName[] {
    return [
        ...(options.includeInternal ? INTERNAL_TOOLS : []),
        ...(options.webSearch ? EXTERNAL_TOOLS : []),
        ...(options.images ? [...IMAGE_TOOLS] : []),
    ];
}

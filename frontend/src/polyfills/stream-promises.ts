import { pipeline as pipelineCb, finished as finishedCb } from 'readable-stream';
import { promisify } from 'util';

export const pipeline = promisify(pipelineCb);
export const finished = promisify(finishedCb);

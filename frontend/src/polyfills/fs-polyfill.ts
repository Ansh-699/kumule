export const promises = {
    readFile: async () => { throw new Error("fs.promises.readFile not implemented in browser") },
};
export const createReadStream = () => { throw new Error("fs.createReadStream not implemented in browser") };
export const createWriteStream = () => { throw new Error("fs.createWriteStream not implemented in browser") };
export const read = () => { throw new Error("fs.read not implemented in browser") };
export const write = () => { throw new Error("fs.write not implemented in browser") };

export default {
    promises,
    createReadStream,
    createWriteStream,
    read,
    write,
};
//ai suggested these streams error logging
/*
 * One-time cleanup for ReadingProgress duplicates created before the
 * "one user + one story = one record" rule existed.
 *
 * For every (user, story) pair with more than one record it keeps ONE record:
 *   - status "completed" if any duplicate was completed
 *   - the earliest createdAt (when the user first started the story)
 * and deletes the rest. Then it builds the unique index.
 *
 * Run from the backend folder:   npm run fix:progress
 * Preview without changing data: npm run fix:progress -- --dry-run
 */
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const ReadingProgress = require("../models/readingprogressmodel");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is missing in backend/.env");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Connected. ${DRY_RUN ? "(dry run, nothing will be changed)" : ""}`);

    const groups = await ReadingProgress.aggregate([
        {
            $group: {
                _id: { user: "$user", story: "$story" },
                ids: { $push: "$_id" },
                count: { $sum: 1 }
            }
        },
        { $match: { count: { $gt: 1 } } }
    ]);

    let removed = 0;

    for (const group of groups) {
        const records = await ReadingProgress.find({ _id: { $in: group.ids } })
            .sort({ createdAt: 1 })
            .lean();

        const keep = records[0];
        const completed = records
            .filter((r) => r.status === "completed")
            .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
        const deleteIds = records.slice(1).map((r) => r._id);

        console.log(
            `user ${group._id.user} / story ${group._id.story}: ${records.length} records -> keeping 1` +
                (completed.length ? " (completed)" : " (in-progress)")
        );

        if (!DRY_RUN) {
            if (completed.length) {
                await ReadingProgress.updateOne(
                    { _id: keep._id },
                    {
                        $set: {
                            status: "completed",
                            completedAt: completed[0].completedAt || completed[0].updatedAt
                        }
                    },
                    { timestamps: false }
                );
            }
            await ReadingProgress.deleteMany({ _id: { $in: deleteIds } });
        }
        removed += deleteIds.length;
    }

    console.log(
        groups.length === 0
            ? "No duplicates found."
            : `${DRY_RUN ? "Would remove" : "Removed"} ${removed} duplicate record(s) across ${groups.length} story/user pair(s).`
    );

    if (!DRY_RUN) {
        await ReadingProgress.syncIndexes();
        console.log("Unique index on { user, story } is in place.");
    }

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error("Failed:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});

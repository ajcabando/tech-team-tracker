package org.opensource.tracker

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

@Entity(tableName = "locations", indices = [Index(value = ["deviceId", "recordedAt"], unique = true)])
data class LocationEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val recordedAt: Long,
    val latitude: Double,
    val longitude: Double,
    val speed: Float?,
    val heading: Float?,
    val accuracy: Float?,
    val altitude: Double?,
    val battery: Int?,
    val networkState: String?
)

@Dao
interface LocationDao {
    /** IGNORE makes re-inserting the same record a no-op, so duplicates never accumulate. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(point: LocationEntity)

    @Query("SELECT * FROM locations ORDER BY recordedAt ASC LIMIT :limit")
    suspend fun pending(limit: Int = 500): List<LocationEntity>

    @Query("DELETE FROM locations WHERE id IN (:ids)")
    suspend fun delete(ids: List<String>)

    @Query("SELECT COUNT(*) FROM locations")
    suspend fun count(): Int

    /**
     * Bounds local storage during long offline stretches: keeps only the newest
     * points so a week without signal cannot grow tracking.db without limit or
     * trigger an hours-long upload storm on reconnect.
     */
    @Query("DELETE FROM locations WHERE id NOT IN (SELECT id FROM locations ORDER BY recordedAt DESC LIMIT :limit)")
    suspend fun pruneToLatest(limit: Int = 20000)
}

@Database(entities = [LocationEntity::class], version = 1, exportSchema = false)
abstract class LocationDatabase : RoomDatabase() {
    abstract fun locations(): LocationDao

    companion object {
        @Volatile
        private var instance: LocationDatabase? = null

        fun create(context: android.content.Context): LocationDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(context.applicationContext, LocationDatabase::class.java, "tracking.db").build().also { instance = it }
            }
    }
}

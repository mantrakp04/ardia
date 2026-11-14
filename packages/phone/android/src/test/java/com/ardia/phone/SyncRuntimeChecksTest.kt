package com.ardia.phone

import org.junit.Assert.assertEquals
import org.junit.Test

class SyncRuntimeChecksTest {
    @Test
    fun eachCheckPassesOnlyWhenTheDeviceGaveExactlyWhatNodeGave() {
        val expected = """{"order":["a","b"],"numbers":{"safe":9007199254740991},"same":[1]}"""
        val actual = """{"order":["b","a"],"numbers":{"safe":9007199254740992},"same":[1],"extra":true}"""
        val outcomes = SyncRuntimeChecks.compare(actual, expected).associateBy { it.name }
        assertEquals(false, outcomes.getValue("order").pass)
        assertEquals(false, outcomes.getValue("numbers").pass)
        assertEquals(true, outcomes.getValue("same").pass)
        assertEquals(false, outcomes.getValue("extra").pass)
        assertEquals(false, SyncRuntimeChecks.compare("not json", expected).first().pass)
    }
}
